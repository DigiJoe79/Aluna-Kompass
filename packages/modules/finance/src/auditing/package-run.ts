import {
  buildContext, EMPTY, hasPermission, launchJob, requirePermission, localizedConflict, newId, notFound, ok, paperDate, prepare, readJobResult, readSetting, requestJobCancel, runningJob, runStep, validate,
  type CallContext, type DbOrTx, type Deps, type JobHandle, type JobRecord, type JobRun, type JobSlot, type JobStart, type Result,
} from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { exportBundle } from '@kompass/module-dms';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { formatAmount } from '../format/amount';
import { REPORT_CATALOG } from '../reporting/catalog';
import { previewFinanceReport } from '../reporting/finalize';
import { financeEntries, financeEntryDocuments, financeFiscalYears, type FinanceFiscalYearRow } from '../schema';
import { auditorsOfYearInternal, requireAuditRead } from './access';
import { baselineShortHashInternal, latestBaselineInternal } from './baseline';
import { AUDIT_FOLDER_TEMPLATE_KEY, type AuditFolderInput } from './folder-template';
import { sectionRowsInternal, type AuditSectionRow } from './sections';
import { AUDIT_SECTIONS, type AuditSection } from './types';

/**
 * Prüfmappe, Prüffassungen und Aktenexport als Lauf (Spec § D1 „Prüfstand“, Kern-Lauf-Mechanik `core/src/jobs/`):
 * ein Lauf je Jahr, gestartet von Hand (Plan D1a Task 9, Abweichung von der Spec „Abschließen erzeugt das Prüfpaket“:
 * ein Lauf in der Abschluss-Transaktion wäre nicht abbrechbar). Platz unter `<DATA_PATH>/.jobs/finance-audit-<Jahr>`,
 * Ergebnisse als Dateien des Moduls (`deps.files('finance')`); ein neuer Prüfstand macht sie ungültig.
 */

export type AuditPackageFile = 'folder' | 'archive' | 'reports';
export const AUDIT_PACKAGE_STEPS = ['reports', 'folder', 'archive'] as const;
const JOB_KIND = 'auditPackage';
const LIMIT = { totalMs: 30 * 60_000, stallMs: 10 * 60_000 };
/** Höchstzahl der Bezüge, die der Aktenexport prüft (Akte: `linkedAccess` bis 2000). */
const MAX_LINKS = 2000;

export interface AuditPackageResult {
  baselineId: string;
  files: Partial<Record<AuditPackageFile, string>>;
  /** Übersprungene Schritte mit Grund (Code). */
  skipped: Partial<Record<AuditPackageFile, string>>;
}

/** Ohne Datenverzeichnis (Skripte) gibt es keinen Platz. */
function dataPathOf(deps: Deps): string | null {
  return (deps as Deps & { dataPath?: string }).dataPath ?? null;
}

export function auditPackageSlot(dataPath: string, fiscalYearId: string): JobSlot {
  const dir = path.join(dataPath, '.jobs', `finance-audit-${fiscalYearId}`);
  return { key: `finance-audit:${path.resolve(dir)}`, dir, workDir: dir, tmpPrefix: 'work-' };
}

const storeName = (fiscalYearId: string, file: AuditPackageFile) => `audit-package-${fiscalYearId.toLowerCase()}-${file}.${file === 'archive' ? 'zip' : 'pdf'}`;

const day = (iso: string) => paperDate(iso.slice(0, 10) as never);

// ── Mappe ───────────────────────────────────────────────────────────────────

const SECTION_TITLE: Record<AuditSection, string> = {
  journal: 'Journal', reconciliation: 'Kontenabstimmung', vouchers: 'Belegprüfung', imports: 'Importabgleich', anomalies: 'Auffälligkeiten',
  purposesReserves: 'Zweckmittel und Rücklagen', donations: 'Spenden', partnerPayments: 'Zahlungen an Partner',
};
const VOUCHER_REASON: Record<string, string> = { missing: 'ohne Beleg', missingJustified: 'ohne Beleg, begründet', own: 'Eigenbeleg', withoutEntry: 'Beleg ohne Buchung', revoked: 'Verknüpfung widerrufen' };
const ANOMALY_TITLE: Record<string, string> = {
  relatedParty: 'Zahlung an Organmitglied oder Nahestehende', cashPayout: 'Barauszahlung', roundAmount: 'Runder Betrag', cashDonation: 'Barspende ab Schwelle', reversal: 'Storno',
  correction: 'Zuordnungskorrektur', lateFinalized: 'Spät festgeschrieben', cashShortfall: 'Kassenfehlbetrag', cashNegative: 'Kasse im Minus', partnerPaymentReason: 'Zahlung an Partner mit Begründung',
  evidenceReused: 'Nachweis mehrfach verwendet', reopened: 'Wiederöffnung', userLink: 'Nutzer-Kontakt-Verknüpfung geändert', finalizedByAgent: 'Über MCP festgeschrieben',
};
const DONATION_KIND: Record<string, string> = { total: 'Spenden gesamt', withoutConfirmation: 'ohne Bestätigung', toCorrect: 'zu korrigieren' };
const PROOF_STATE: Record<string, string> = { acknowledged: 'anerkannt', overdue: 'überfällig', open: 'offen' };

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const amount = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : formatAmount(cents));

function sectionTable(section: AuditSection, rows: AuditSectionRow[]): AuditFolderInput['sections'][number] {
  const p = (r: AuditSectionRow) => r.labelParams;
  const date = (r: AuditSectionRow) => (r.date ? day(r.date) : '');
  switch (section) {
    case 'journal': return { title: SECTION_TITLE[section], checkColumn: true, columns: ['Datum', 'Nr.', 'Text', 'Zweck / Kategorie', 'Konto', 'Betrag'], rows: rows.map((r) => [date(r), s(p(r).number), s(p(r).text), s(p(r).purposeOrCategory), s(p(r).accountName), amount(r.amountCents)]) };
    case 'reconciliation': return { title: SECTION_TITLE[section], checkColumn: false, columns: ['Konto', 'Buchbestand', 'Gegenprobe', 'Stand'], rows: rows.map((r) => [s(p(r).accountName), amount(p(r).bookCents as number), amount(p(r).againstCents as number | null), s(p(r).state)]) };
    case 'vouchers': return { title: SECTION_TITLE[section], checkColumn: false, columns: ['Datum', 'Grund', 'Nr.', 'Beleg'], rows: rows.map((r) => [date(r), VOUCHER_REASON[s(p(r).reason)] ?? s(p(r).reason), s(p(r).number), s(p(r).subject)]) };
    case 'imports': return { title: SECTION_TITLE[section], checkColumn: false, columns: ['Datum', 'Art', 'Betrag', 'Gegenpartei', 'Verwendungszweck'], rows: rows.map((r) => [date(r), p(r).kind === 'open' ? 'nicht gebucht' : `Dublette: ${s(p(r).decision)}`, amount(r.amountCents), s(p(r).counterparty), s(p(r).purpose)]) };
    case 'anomalies': return { title: SECTION_TITLE[section], checkColumn: true, columns: ['Art', 'Datum', 'Nr.', 'Betrag'], rows: rows.map((r) => [ANOMALY_TITLE[r.kind] ?? r.kind, date(r), s(p(r).number ?? p(r).paymentNumber), amount(r.amountCents)]) };
    case 'purposesReserves': return { title: SECTION_TITLE[section], checkColumn: false, columns: ['Name', 'Vortrag', 'Zugang', 'Verwendet', 'Ende'], rows: rows.map((r) => [s(p(r).name), amount(p(r).carryForwardCents as number), amount(p(r).inflowCents as number), amount(p(r).usedCents as number), amount(p(r).closingCents as number)]) };
    case 'donations': return { title: SECTION_TITLE[section], checkColumn: false, columns: ['', 'Anzahl', 'Summe'], rows: rows.map((r) => [DONATION_KIND[s(p(r).kind)] ?? s(p(r).kind), s(p(r).count), amount(r.amountCents)]) };
    case 'partnerPayments': return { title: SECTION_TITLE[section], checkColumn: true, columns: ['Datum', 'Nr.', 'Partner', 'Nachweis'], rows: rows.map((r) => [date(r), s(p(r).number), s(p(r).partnerName), PROOF_STATE[s(p(r).proofState)] ?? s(p(r).proofState)]) };
  }
}

async function folderInputInternal(deps: Deps, ctx: CallContext, year: FinanceFiscalYearRow, baselineId: string, createdAt: string): Promise<AuditFolderInput> {
  const db: DbOrTx = deps.db;
  const auditors = auditorsOfYearInternal(db, year.id).map((a) => {
    const c = db.select().from(contacts).where(eq(contacts.id, a.contactId)).get();
    return `${c ? displayName(c) : ''}${a.mode === 'paper' ? ' (auf Papier)' : ''}`;
  });
  const hash = baselineShortHashInternal(db, baselineId);
  const sections: AuditFolderInput['sections'] = [];
  for (const section of AUDIT_SECTIONS) sections.push(sectionTable(section, await sectionRowsInternal(deps, ctx, year, section)));
  return {
    title: `Kassenprüfung ${year.designation}`,
    cover: [
      { label: 'Verein', value: String(readSetting<string>(deps, 'organization.name') ?? '') },
      { label: 'Geschäftsjahr', value: `${year.designation} (${day(year.startsOn)}–${day(year.endsOn)})` },
      { label: 'Prüfer', value: auditors.join(', ') || EMPTY },
      { label: 'Stand', value: `Prüffassung vom ${day(createdAt)}` },
      { label: 'Kurz-Hash', value: hash },
    ],
    sections,
    footerNote: `Prüfstand vom ${day(createdAt)} · ${hash}`,
  };
}

// ── Lauf ────────────────────────────────────────────────────────────────────

async function produce(deps: Deps, ctx: CallContext, year: FinanceFiscalYearRow, baselineId: string, createdAt: string, slot: JobSlot, h: JobHandle): Promise<Result<AuditPackageResult>> {
  const store = deps.files('finance');
  const files: AuditPackageResult['files'] = {};
  const skipped: AuditPackageResult['skipped'] = {};

  await runStep(h, 'reports', LIMIT, async (c) => {
    const defs = REPORT_CATALOG.filter((d) => d.available && (d.group === 'assembly' || d.group === 'audit') && d.paramsSchema.safeParse({ fiscalYearId: year.id }).success);
    const pdfs: Uint8Array[] = [];
    for (const [i, def] of defs.entries()) {
      c.signal.throwIfAborted();
      const preview = await previewFinanceReport(deps, ctx, { report: def.key, params: { fiscalYearId: year.id } });
      if (preview.ok) pdfs.push(preview.value.bytes);
      c.progress(i + 1, defs.length);
    }
    if (pdfs.length === 0) return void (skipped.reports = 'noReports');
    const merged = pdfs.length === 1 ? pdfs[0]! : await deps.pdf.merge(pdfs);
    await store.write(storeName(year.id, 'reports'), merged);
    files.reports = storeName(year.id, 'reports');
  });

  await runStep(h, 'folder', LIMIT, async () => {
    const input = await folderInputInternal(deps, ctx, year, baselineId, createdAt);
    const prepared = await prepare(deps, ctx, { templateKey: AUDIT_FOLDER_TEMPLATE_KEY, input }, { number: '' });
    if (!prepared.ok) return void (skipped.folder = 'renderFailed');
    const { built, baseId, bodyTypst, images } = prepared.value;
    const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context: await buildContext(deps, ctx, ''), images });
    await store.write(storeName(year.id, 'folder'), bytes);
    files.folder = storeName(year.id, 'folder');
  });

  if (!hasPermission(ctx, 'documents.export')) {
    skipped.archive = 'noExportPermission';
    h.skip('archive');
  } else {
    await runStep(h, 'archive', LIMIT, async () => {
      const entryIds = deps.db.select({ id: financeEntries.id }).from(financeEntries).where(and(eq(financeEntries.fiscalYearId, year.id), eq(financeEntries.status, 'final'))).all().map((e) => e.id);
      if (entryIds.length > MAX_LINKS) return void (skipped.archive = 'tooManyEntries');
      const documentIds = entryIds.length === 0 ? [] : [...new Set(deps.db.select({ documentId: financeEntryDocuments.documentId }).from(financeEntryDocuments).where(and(inArray(financeEntryDocuments.entryId, entryIds), isNotNull(financeEntryDocuments.documentId))).all().map((d) => d.documentId!))];
      if (documentIds.length === 0) return void (skipped.archive = 'noDocuments');
      if (documentIds.length > 500) return void (skipped.archive = 'tooManyDocuments');
      const work = path.join(slot.workDir, `work-${newId().toLowerCase()}`);
      mkdirSync(work, { recursive: true });
      try {
        const bundle = await exportBundle(deps, ctx, { documentIds, order: 'number', linkedAccess: entryIds.map((id) => ({ entityType: 'financeEntry', entityId: id })), workDir: work });
        if (!bundle.ok) return void (skipped.archive = bundle.error.type === 'conflict' ? bundle.error.code : bundle.error.type);
        await store.write(storeName(year.id, 'archive'), readFileSync(bundle.value.archivePath));
        files.archive = storeName(year.id, 'archive');
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });
  }
  return ok({ baselineId, files, skipped });
}

const yearSchema = z.object({ fiscalYearId: z.string().min(1) });

function prepareYear(deps: Deps, ctx: CallContext, input: unknown): Result<{ year: FinanceFiscalYearRow; slot: JobSlot }> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, yearSchema, input);
  if (!parsed.ok) return parsed;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  const dataPath = dataPathOf(deps);
  if (!dataPath) return financeConflict('auditPackageNoStorage');
  return ok({ year, slot: auditPackageSlot(dataPath, year.id) });
}

/**
 * Erzeugen und Abbrechen sind Sache des Vorstands (Joe 2026-10-25, Befund 11 a): dasselbe Recht wie Schritt 9 des
 * Jahresabschlusses. Stand und Herunterladen bleiben bei `requireAuditRead` — Prüfer lesen, was der Vorstand erzeugt.
 */
const requireBoard = (ctx: CallContext) => requirePermission(ctx, 'finance.periodClose');

/**
 * `finance.periodClose` (dazu `finance.read` oder `finance.audit`), auch über MCP: Prüffassungen, Mappe und
 * Aktenexport im Hintergrund erzeugen. Nur im abgeschlossenen Jahr mit Prüfstand; läuft schon ein Lauf des Jahres,
 * meldet er ihn.
 */
export async function startAuditPackageRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<JobStart>> {
  const notBoard = requireBoard(ctx);
  if (notBoard) return notBoard;
  const prepared = prepareYear(deps, ctx, input);
  if (!prepared.ok) return prepared;
  const { year, slot } = prepared.value;
  if (fiscalYearStatusInternal(deps.db, year.id) !== 'closed') return financeConflict('auditReportYearOpen', { designation: year.designation });
  const baseline = latestBaselineInternal(deps.db, year.id);
  if (!baseline) return financeConflict('auditPackageNoBaseline', { designation: year.designation });
  const busy = runningJob(slot);
  if (busy) return ok({ started: false, running: busy });
  // Ein neuer Lauf verwirft die Ergebnisse des vorigen.
  for (const file of AUDIT_PACKAGE_STEPS) await deps.files('finance').delete(storeName(year.id, file));
  const started = launchJob(slot, deps.clock, { kind: JOB_KIND, steps: AUDIT_PACKAGE_STEPS, source: ctx.channel === 'mcp' ? 'mcp' : 'ui', userId: ctx.userId, apiTokenId: ctx.apiTokenId, runId: newId(), meta: { fiscalYearId: year.id, baselineId: baseline.id } }, (h) =>
    produce(deps, ctx, year, baseline.id, baseline.createdAt, slot, h),
  );
  if ('busy' in started) return ok({ started: false, running: started.busy });
  started.done.catch(() => undefined); // launchJob schreibt den Fehler ins Ergebnis
  return ok({ started: true, runId: started.run.runId, startedAt: started.run.startedAt });
}

export interface AuditPackageRunStatus {
  running: JobRun | null;
  last: JobRecord<AuditPackageResult> | null;
  /** Dateien des letzten erfolgreichen Laufs, solange sein Prüfstand der jüngste ist. */
  files: AuditPackageFile[];
  /** Es gibt einen neueren Prüfstand als den des letzten Laufs. */
  outdated: boolean;
}

export function auditPackageStatusInternal(deps: Deps, fiscalYearId: string): AuditPackageRunStatus | null {
  const dataPath = dataPathOf(deps);
  if (!dataPath) return null;
  const slot = auditPackageSlot(dataPath, fiscalYearId);
  const last = readJobResult<AuditPackageResult>(slot, JOB_KIND);
  const latest = latestBaselineInternal(deps.db, fiscalYearId);
  const outdated = Boolean(last?.result && latest && last.result.baselineId !== latest.id);
  const files = last?.status === 'success' && last.result && !outdated ? (Object.keys(last.result.files) as AuditPackageFile[]) : [];
  return { running: runningJob(slot), last, files, outdated };
}

/** `finance.read` oder `finance.audit`, auch über MCP: Stand des Laufs eines Jahres. */
export async function auditPackageRunStatus(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditPackageRunStatus>> {
  const prepared = prepareYear(deps, ctx, input);
  if (!prepared.ok) return prepared;
  return ok(auditPackageStatusInternal(deps, prepared.value.year.id)!);
}

/** `finance.periodClose` (dazu `finance.read` oder `finance.audit`), auch über MCP: den laufenden Lauf des Jahres abbrechen. */
export async function cancelAuditPackageRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ cancelled: true }>> {
  const notBoard = requireBoard(ctx);
  if (notBoard) return notBoard;
  const prepared = prepareYear(deps, ctx, input);
  if (!prepared.ok) return prepared;
  const run = runningJob(prepared.value.slot);
  if (!run) return localizedConflict('jobNotRunning', 'jobs.errors.jobNotRunning');
  if (!requestJobCancel(prepared.value.slot, run.runId)) return localizedConflict('jobNotCancellable', 'jobs.errors.jobNotCancellable');
  return ok({ cancelled: true as const });
}

const fileSchema = z.object({ fiscalYearId: z.string().min(1), file: z.enum(['folder', 'archive', 'reports']) });

/** `finance.read` oder `finance.audit`: eine Ergebnisdatei des Laufs. Liefert Bytes: kein MCP-Werkzeug. */
export async function readAuditPackageFile(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; mimeType: string }>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, fileSchema, input);
  if (!parsed.ok) return parsed;
  // Der Aktenexport ist ein Bündel der Akte: herunterladen nur mit dem Recht dazu, gleich wer den Lauf gestartet hat.
  if (parsed.value.file === 'archive') {
    const noExport = requirePermission(ctx, 'documents.export');
    if (noExport) return noExport;
  }
  const prepared = prepareYear(deps, ctx, { fiscalYearId: parsed.value.fiscalYearId });
  if (!prepared.ok) return prepared;
  const status = auditPackageStatusInternal(deps, prepared.value.year.id)!;
  if (!status.files.includes(parsed.value.file)) return financeConflict(status.outdated ? 'auditPackageOutdated' : 'auditPackageFileMissing');
  const name = storeName(prepared.value.year.id, parsed.value.file);
  const bytes = await deps.files('finance').read(name);
  const label = { folder: 'Pruefmappe', archive: 'Aktenexport', reports: 'Prueffassungen' }[parsed.value.file];
  return ok({ bytes, filename: `${label}-${prepared.value.year.designation}.${parsed.value.file === 'archive' ? 'zip' : 'pdf'}`, mimeType: parsed.value.file === 'archive' ? 'application/zip' : 'application/pdf' });
}

/** Für den Status der Kassenprüfung (`AuditStatus.packageRun`). */
export function packageRunSummaryInternal(deps: Deps, fiscalYearId: string): { state: string; finishedAt: string | null; files: AuditPackageFile[] } | null {
  const status = auditPackageStatusInternal(deps, fiscalYearId);
  if (!status) return null;
  if (status.running) return { state: 'running', finishedAt: null, files: [] };
  if (!status.last) return null;
  return { state: status.outdated ? 'outdated' : status.last.status, finishedAt: status.last.finishedAt, files: status.files };
}

