import {
  isoDayIn, launchJob, localizedConflict, newId, notFound, ok, paperDate, readJobResult, readSetting, requestJobCancel, requirePermission, runningJob, runStep, validate, csvField,
  timeZoneOf, type CallContext, type Deps, type Failure, type JobHandle, type JobRecord, type JobRun, type JobSlot, type JobStart, type Result,
} from '@kompass/core';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Zip, ZipPassThrough } from 'fflate';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { financeAudit } from '../../audit';
import { financeConflict } from '../../errors';
import { requireFinanceRead } from '../../ledger/access';
import { fiscalYearStatusInternal } from '../../ledger/fiscal-years';
import { financeDataExports, financeFiscalYears } from '../../schema';
import { designationsOf, fieldDescriptionCsv, gdpduIndexXml, readmeText } from './describe';
import { GDPDU_DTD, GDPDU_DTD_FILE } from './gdpdu-dtd';
import { dataExportExpired, dataExportExpiresAt } from './sweep';
import { EXPORT_TABLES, exportLine, type DataExportStep, type ExportScope, type ExportTable } from './tables';

/**
 * Der Datenexport für eine Außenprüfung (§ 147 Abs. 6 AO) als Lauf der Kern-Lauf-Mechanik (Vorbild
 * `auditing/package-run.ts`): **ein** Platz für die Installation, nicht je Jahr. Schritte 1–4 schreiben die CSV-Dateien
 * in ein Arbeitsverzeichnis, Schritt 5 Beschreibung und ZIP. Erst danach liegt das ZIP in den Dateien des Moduls und
 * entsteht in einer Transaktion Zeile und Protokoll — ein Abbruch, ein Fehler oder ein Neustart hinterlässt nichts.
 *
 * Rechte: `documents.export` **und** `finance.read` (die Daten tragen Kontakte), für alle fünf Dienste; jeder mit
 * beiden Rechten darf erzeugen und herunterladen, nicht nur, wer erzeugt hat. Nicht `humanOnly`: Der Export ändert
 * keine Finanzdaten.
 */

export const DATA_EXPORT_STEPS = ['entries', 'masterData', 'vouchers', 'history', 'package'] as const satisfies readonly DataExportStep[];
const JOB_KIND = 'dataExport';
const LIMIT = { totalMs: 30 * 60_000, stallMs: 10 * 60_000 };
const BATCH = 1000;

export function dataExportSlot(dataPath: string): JobSlot {
  const dir = path.join(dataPath, '.jobs', 'finance-data-export');
  return { key: `finance-data-export:${path.resolve(dir)}`, dir, workDir: dir, tmpPrefix: 'work-' };
}

function dataPathOf(deps: Deps): string | null {
  return (deps as Deps & { dataPath?: string }).dataPath ?? null;
}

function requireExportRights(ctx: CallContext): Failure | null {
  return requireFinanceRead(ctx, 'read') ?? requirePermission(ctx, 'documents.export');
}

const storeName = (exportId: string) => `data-export-${exportId.toLowerCase()}.zip`;

// ── Dateien schreiben ───────────────────────────────────────────────────────

/** Eine CSV-Datei in Blöcken auf die Platte: nie der ganze Jahrgang im Speicher. */
async function writeTable(file: string, table: ExportTable, deps: Deps, scope: ExportScope, signal: AbortSignal): Promise<void> {
  const handle = await open(file, 'w');
  try {
    let chunk = `﻿${table.columns.map((c) => csvField(c.name)).join(';')}\r\n`;
    let count = 0;
    for (const row of table.rows(deps.db, scope)) {
      chunk += `${exportLine(table, row)}\r\n`;
      if (++count % BATCH === 0) {
        await handle.write(chunk);
        chunk = '';
        signal.throwIfAborted();
      }
    }
    await handle.write(chunk);
  } finally {
    await handle.close();
  }
  signal.throwIfAborted();
}

/** Alle Dateien des Arbeitsverzeichnisses als ZIP, gestreamt wie das Bündel der Akte (`dms/bundle.ts`). */
async function zipFiles(work: string, names: readonly string[], target: string, mtime: Date, signal: AbortSignal): Promise<void> {
  const out = createWriteStream(target);
  const stream = { failed: null as Error | null, blocked: false };
  const zip = new Zip((error, chunk) => {
    if (error) stream.failed = error;
    else if (!out.write(chunk)) stream.blocked = true;
  });
  const settle = async () => {
    if (stream.blocked) { stream.blocked = false; await once(out, 'drain'); }
    if (stream.failed) throw stream.failed;
  };
  try {
    for (const name of names) {
      signal.throwIfAborted();
      const entry = new ZipPassThrough(name);
      entry.mtime = mtime;
      zip.add(entry);
      for await (const part of createReadStream(path.join(work, name))) {
        entry.push(part as Uint8Array, false);
        await settle();
      }
      entry.push(new Uint8Array(0), true);
      await settle();
    }
    zip.end();
    out.end();
    await once(out, 'finish');
    if (stream.failed) throw stream.failed;
  } catch (error) {
    out.destroy();
    throw error;
  }
}

const PACKAGE_FILES = ['index.xml', 'feldbeschreibung.csv', 'LIESMICH.txt', GDPDU_DTD_FILE] as const;

interface ExportPlan { exportId: string; fileName: string; scope: ExportScope; designations: string; provisional: string }

async function produce(deps: Deps, ctx: CallContext, plan: ExportPlan, slot: JobSlot, h: JobHandle): Promise<Result<{ exportId: string }>> {
  const work = path.join(slot.workDir, `work-${plan.exportId.toLowerCase()}`);
  mkdirSync(work, { recursive: true });
  try {
    for (const step of DATA_EXPORT_STEPS.filter((s) => s !== 'package')) {
      const tables = EXPORT_TABLES.filter((t) => t.step === step);
      await runStep(h, step, LIMIT, async (c) => {
        for (const [i, table] of tables.entries()) {
          await writeTable(path.join(work, table.file), table, deps, plan.scope, c.signal);
          c.progress(i + 1, tables.length);
        }
      });
    }
    const createdAt = deps.clock.now().toISOString();
    const archive = path.join(work, 'archive.zip');
    await runStep(h, 'package', LIMIT, async (c) => {
      const street = String(readSetting<string>(deps, 'organization.street') ?? '');
      const place = [readSetting<string>(deps, 'organization.postalCode'), readSetting<string>(deps, 'organization.city')].filter(Boolean).join(' ');
      const meta = { supplier: String(readSetting<string>(deps, 'organization.name') ?? ''), location: [street, place].filter(Boolean).join(', '), createdAt, scope: plan.scope };
      const write = async (name: string, text: string) => {
        const handle = await open(path.join(work, name), 'w');
        await handle.write(text);
        await handle.close();
      };
      await write('index.xml', gdpduIndexXml(EXPORT_TABLES, meta));
      await write('feldbeschreibung.csv', fieldDescriptionCsv(EXPORT_TABLES));
      await write('LIESMICH.txt', readmeText({ createdAt, scope: plan.scope }, EXPORT_TABLES));
      await write(GDPDU_DTD_FILE, GDPDU_DTD);
      c.progress(1, 2);
      await zipFiles(work, [...EXPORT_TABLES.map((t) => t.file), ...PACKAGE_FILES], archive, deps.clock.now(), c.signal);
      c.progress(2, 2);
    });
    // Ab hier keine Abbruchstelle mehr: Datei ablegen, dann Zeile und Protokoll in einer Transaktion.
    const bytes = readFileSync(archive);
    await deps.files('finance').write(plan.fileName, bytes);
    deps.db.transaction((tx) => {
      tx.insert(financeDataExports).values({
        id: plan.exportId, fiscalYearIds: JSON.stringify(plan.scope.fiscalYears.map((y) => y.id)), designations: plan.designations, provisional: plan.provisional, fileName: plan.fileName,
        sizeBytes: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex'), createdAt, createdByUserId: ctx.userId, channel: ctx.channel === 'mcp' ? 'mcp' : 'ui',
      }).run();
      financeAudit(tx, deps, ctx, { action: 'finance.dataExport.create', entity: 'financeDataExport', id: plan.exportId, after: { fiscalYearIds: plan.scope.fiscalYears.map((y) => y.id), sizeBytes: bytes.length }, params: { years: plan.designations, provisional: plan.provisional } });
    });
    return ok({ exportId: plan.exportId });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Was ein früherer Lauf oder das Aufräumen liegen ließ: das ZIP eines Laufs, der ohne Zeile endete (Neustart zwischen
 * Ablegen und Transaktion), und Dateien, deren Zeile schon als gelöscht gilt (Abbruch des Aufräumens).
 */
async function removeStrayFiles(deps: Deps, slot: JobSlot): Promise<void> {
  const store = deps.files('finance');
  const last = readJobResult(slot, JOB_KIND);
  const stray = typeof last?.meta.fileName === 'string' ? last.meta.fileName : null;
  if (stray && last?.status !== 'success' && !deps.db.select({ id: financeDataExports.id }).from(financeDataExports).where(eq(financeDataExports.fileName, stray)).get()) await store.delete(stray);
  for (const row of deps.db.select({ fileName: financeDataExports.fileName }).from(financeDataExports).where(isNotNull(financeDataExports.fileDeletedAt)).all()) await store.delete(row.fileName);
}

// ── Dienste ─────────────────────────────────────────────────────────────────

const startSchema = z.object({ fiscalYearIds: z.array(z.string().min(1)).min(1).max(50) });

/** `documents.export` und `finance.read`, auch über MCP: den Export der gewählten Jahre im Hintergrund erzeugen. Läuft schon einer, meldet er ihn. */
export async function startDataExport(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<JobStart>> {
  const denied = requireExportRights(ctx);
  if (denied) return denied;
  const parsed = validate(deps, startSchema, input);
  if (!parsed.ok) return parsed;
  const wanted = [...new Set(parsed.value.fiscalYearIds)];
  const years = deps.db.select().from(financeFiscalYears).where(inArray(financeFiscalYears.id, wanted)).all();
  const missing = wanted.find((id) => !years.some((y) => y.id === id));
  if (missing) return notFound('financeFiscalYear', missing);
  const dataPath = dataPathOf(deps);
  if (!dataPath) return financeConflict('dataExportNoStorage');
  const slot = dataExportSlot(dataPath);
  const busy = runningJob(slot);
  if (busy) return ok({ started: false, running: busy });
  await removeStrayFiles(deps, slot);
  const scope: ExportScope = {
    fiscalYears: years.sort((a, b) => a.startsOn.localeCompare(b.startsOn)).map((y) => ({ id: y.id, designation: y.designation, startsOn: y.startsOn, endsOn: y.endsOn, open: fiscalYearStatusInternal(deps.db, y.id) !== 'closed' })),
    locale: deps.locales()[0] ?? 'de',
    timeZone: timeZoneOf(deps),
  };
  const exportId = newId();
  const plan: ExportPlan = { exportId, fileName: storeName(exportId), scope, designations: designationsOf(scope), provisional: designationsOf(scope, true) };
  const started = launchJob(
    slot,
    deps.clock,
    { kind: JOB_KIND, steps: DATA_EXPORT_STEPS, source: ctx.channel === 'mcp' ? 'mcp' : 'ui', userId: ctx.userId, apiTokenId: ctx.apiTokenId, runId: newId(), meta: { exportId, fileName: plan.fileName, designations: plan.designations, provisional: plan.provisional } },
    (h) => produce(deps, ctx, plan, slot, h),
  );
  if ('busy' in started) return ok({ started: false, running: started.busy });
  started.done.catch(() => undefined); // launchJob schreibt den Fehler ins Ergebnis
  return ok({ started: true, runId: started.run.runId, startedAt: started.run.startedAt });
}

const emptySchema = z.object({}).strict();

function prepareSlot(deps: Deps, ctx: CallContext, input: unknown): Result<JobSlot> {
  const denied = requireExportRights(ctx);
  if (denied) return denied;
  const parsed = validate(deps, emptySchema, input ?? {});
  if (!parsed.ok) return parsed;
  const dataPath = dataPathOf(deps);
  if (!dataPath) return financeConflict('dataExportNoStorage');
  return ok(dataExportSlot(dataPath));
}

export interface DataExportRunStatus { running: JobRun | null; last: JobRecord<{ exportId: string }> | null }

/** Stand des Laufs, ohne Rechteprüfung — für die Status-Route nach ihrer eigenen Prüfung. */
export function dataExportStatusInternal(deps: Deps): DataExportRunStatus | null {
  const dataPath = dataPathOf(deps);
  if (!dataPath) return null;
  const slot = dataExportSlot(dataPath);
  return { running: runningJob(slot), last: readJobResult<{ exportId: string }>(slot, JOB_KIND) };
}

/** `documents.export` und `finance.read`, auch über MCP: der laufende Export und der letzte. */
export async function dataExportRunStatus(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DataExportRunStatus>> {
  const slot = prepareSlot(deps, ctx, input);
  if (!slot.ok) return slot;
  return ok({ running: runningJob(slot.value), last: readJobResult<{ exportId: string }>(slot.value, JOB_KIND) });
}

/** `documents.export` und `finance.read`, auch über MCP: den laufenden Export abbrechen. */
export async function cancelDataExport(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ cancelled: true }>> {
  const slot = prepareSlot(deps, ctx, input);
  if (!slot.ok) return slot;
  const run = runningJob(slot.value);
  if (!run) return localizedConflict('jobNotRunning', 'jobs.errors.jobNotRunning');
  if (!requestJobCancel(slot.value, run.runId)) return localizedConflict('jobNotCancellable', 'jobs.errors.jobNotCancellable');
  return ok({ cancelled: true as const });
}

export interface DataExportView { id: string; createdAt: string; expiresAt: string; designations: string; provisional: string; byUserId: string | null; sizeBytes: number }

/** `documents.export` und `finance.read`, auch über MCP: die Exporte, die noch herunterzuladen sind, neueste zuerst. */
export async function listDataExports(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ exports: DataExportView[] }>> {
  const denied = requireExportRights(ctx);
  if (denied) return denied;
  const parsed = validate(deps, emptySchema, input ?? {});
  if (!parsed.ok) return parsed;
  const now = deps.clock.now();
  const rows = deps.db.select().from(financeDataExports).where(isNull(financeDataExports.fileDeletedAt)).orderBy(desc(financeDataExports.createdAt)).all();
  return ok({
    exports: rows.filter((r) => !dataExportExpired(r.createdAt, now)).map((r) => ({ id: r.id, createdAt: r.createdAt, expiresAt: dataExportExpiresAt(r.createdAt), designations: r.designations, provisional: r.provisional, byUserId: r.createdByUserId, sizeBytes: r.sizeBytes })),
  });
}

const fileSchema = z.object({ exportId: z.string().min(1) });

/** `documents.export` und `finance.read`: das ZIP eines Exports. Liefert Bytes: kein MCP-Werkzeug; protokolliert. */
export async function readDataExportFile(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string }>> {
  const denied = requireExportRights(ctx);
  if (denied) return denied;
  const parsed = validate(deps, fileSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(financeDataExports).where(eq(financeDataExports.id, parsed.value.exportId)).get();
  if (!row) return notFound('financeDataExport', parsed.value.exportId);
  if (row.fileDeletedAt || dataExportExpired(row.createdAt, deps.clock.now()) || !(await deps.files('finance').exists(row.fileName))) return financeConflict('dataExportExpired');
  const bytes = await deps.files('finance').read(row.fileName);
  deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.dataExport.download', entity: 'financeDataExport', id: row.id, params: { years: row.designations } }));
  const years = row.designations.split(', ').join('-');
  return ok({ bytes, filename: `Datenexport-${years}${row.provisional ? '-vorlaeufig' : ''}-${paperDate(isoDayIn(deps, Date.parse(row.createdAt)))}.zip` });
}

