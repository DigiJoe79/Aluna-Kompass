import { buildContext, conflict, hasPermission, isoNow, linkedAccess, ok, prepare, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { Zip, ZipPassThrough } from 'fflate';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isProtectedType, requireDmsGate, requireReadable } from './access';
import { bundleCsv, type BundleEntry } from './bundle-index';
import { documentTypeFor } from './catalog';
import { documentLinks, documents, type DocumentRow } from './schema';
import { checkDocumentFile } from './service';

export const BUNDLE_MAX_DOCUMENTS = 500;
export const BUNDLE_MAX_BYTES = 500 * 1024 * 1024;

export const bundleSelectionSchema = z
  .object({
    documentIds: z.array(z.string().min(1)).min(1).max(BUNDLE_MAX_DOCUMENTS).optional(),
    folder: z.string().trim().min(1).optional(),
    year: z.number().int().min(1900).max(2999).optional(),
    order: z.enum(['number', 'documentDate']).default('number'),
    linkedAccess: z.array(z.object({ entityType: z.string().min(1), entityId: z.string().min(1) })).max(2000).default([]),
  })
  .refine((v) => [v.documentIds, v.folder, v.year].filter((x) => x !== undefined).length === 1, { path: ['selection'], message: 'exactlyOneSelection' });

export type BundleSelection = z.input<typeof bundleSelectionSchema>;
export interface BundleRow { row: DocumentRow; readable: boolean; protectedType: boolean }

/**
 * Wer im Bündel steht und was der Aufrufer davon lesen darf — noch ohne Dateien.
 *
 * Lesbar heißt: nach den Regeln der Akte (`requireReadable`) **oder** über den
 * Bezug als Berechtigung (Vorarbeiten-Spec V2): Das aufrufende Modul nennt seine
 * Vorgänge, und die Akte prüft für jeden selbst, ob der Typ angemeldet ist, ob
 * der Aufrufer dessen Leserecht hat und ob das Dokument wirklich daran hängt.
 * So fehlt im Prüfpaket der Finanzen kein Beleg, nur weil er eine Art des
 * Vereins trägt — und niemand liest über eine erfundene Vorgangsliste mit.
 */
export function resolveBundle(deps: Deps, ctx: CallContext, selection: BundleSelection): Result<{ title: string; rows: BundleRow[] }> {
  const denied = requirePermission(ctx, 'documents.export');
  if (denied) return denied;
  const parsed = validate(deps, bundleSelectionSchema, selection);
  if (!parsed.ok) return parsed;
  const q = parsed.value;

  // Ordner und Jahrgang sind Blättern in der Akte; eine ID-Liste bringt ein Modul mit.
  if (q.documentIds === undefined) {
    const gate = requireDmsGate(deps, ctx);
    if (gate) return gate;
  }

  const issued = eq(documents.phase, 'issued');
  const where =
    q.documentIds !== undefined ? and(issued, inArray(documents.id, q.documentIds))
    : q.folder !== undefined ? and(issued, or(eq(documents.folder, q.folder), like(documents.folder, `${q.folder}/%`)))
    : and(issued, sql`substr(${documents.documentDate}, 1, 4) = ${String(q.year)}`);
  const found = deps.db.select().from(documents).where(where).orderBy(asc(q.order === 'number' ? documents.number : documents.documentDate), asc(documents.number)).all();

  if (found.length === 0) return conflict('bundleEmpty', 'Zu dieser Auswahl gibt es kein festgeschriebenes Dokument.');
  if (found.length > BUNDLE_MAX_DOCUMENTS) return conflict('bundleTooLarge', `Die Auswahl umfasst ${found.length} Dokumente; ein Bündel fasst höchstens ${BUNDLE_MAX_DOCUMENTS}. Wählen Sie einen Unterordner oder ein einzelnes Jahr.`);
  const bytes = found.reduce((sum, row) => sum + (row.fileBytes ?? 0), 0);
  if (bytes > BUNDLE_MAX_BYTES) return conflict('bundleTooLarge', `Die Auswahl umfasst ${Math.ceil(bytes / 1024 / 1024)} MB; ein Bündel fasst höchstens ${BUNDLE_MAX_BYTES / 1024 / 1024} MB. Wählen Sie einen Unterordner oder ein einzelnes Jahr.`);

  // Nur Vorgänge, deren Typ angemeldet ist und deren Leserecht der Aufrufer hat.
  const granted = q.linkedAccess.filter((a) => {
    const access = linkedAccess(deps, a.entityType);
    return access !== null && hasPermission(ctx, access.readPermission);
  });
  const viaLink = (documentId: string): boolean =>
    granted.length > 0 &&
    deps.db.select({ entityType: documentLinks.entityType, entityId: documentLinks.entityId }).from(documentLinks).where(eq(documentLinks.documentId, documentId)).all()
      .some((l) => granted.some((g) => g.entityType === l.entityType && g.entityId === l.entityId));

  const rows = found.map((row) => ({ row, readable: requireReadable(deps, ctx, row) === null || viaLink(row.id), protectedType: isProtectedType(documentTypeFor(deps.db, row.typeKey)) }));
  const title = q.documentIds !== undefined ? `Auswahl von ${rows.length} Dokumenten` : q.folder !== undefined ? `Ordner ${q.folder}` : `Jahrgang ${q.year}`;
  return ok({ title, rows });
}

const slug = (s: string) => s.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * Das Bündel als Datei im Arbeitsverzeichnis — nie im Speicher: Ein Jahrgang hat
 * Hunderte Megabyte. Jede Datei wird einzeln gelesen, gegen ihre Prüfsumme
 * gehalten und in den Strom gegeben; eine veränderte liegt **nicht** bei,
 * sondern steht mit diesem Befund im Verzeichnis. Das Bündel ist ein Auszug und
 * wird nicht abgelegt; protokolliert wird, wer welche Nummern gezogen hat.
 */
export async function exportBundle(deps: Deps, ctx: CallContext, input: BundleSelection & { workDir: string }): Promise<Result<{ archivePath: string; filename: string; included: number; listedOnly: number }>> {
  const { workDir, ...selection } = input;
  const resolved = resolveBundle(deps, ctx, selection);
  if (!resolved.ok) return resolved;
  const { title, rows } = resolved.value;

  const filename = `Akte-${slug(title)}-${isoNow(deps.clock).slice(0, 10)}.zip`;
  const archivePath = path.join(workDir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`);
  const out = createWriteStream(archivePath);
  // Ein Objekt, keine `let`-Variablen: TypeScript verfolgt Zuweisungen aus dem
  // Callback nicht und hielte `failed` sonst für immer `null`.
  const stream = { failed: null as Error | null, blocked: false };
  const zip = new Zip((error, chunk) => {
    if (error) stream.failed = error;
    else if (!out.write(chunk)) stream.blocked = true;
  });
  const mtime = deps.clock.now();
  const add = async (name: string, bytes: Uint8Array) => {
    const file = new ZipPassThrough(name);
    file.mtime = mtime;
    zip.add(file);
    file.push(bytes, true);
    // Auf `drain` warten, sonst stapelt sich ein Jahrgang im Speicher statt auf der Platte.
    if (stream.blocked) { stream.blocked = false; await once(out, 'drain'); }
    if (stream.failed) throw stream.failed;
  };

  try {
    const entries: BundleEntry[] = [];
    for (const { row, readable, protectedType } of rows) {
      const number = row.number!;
      if (!readable) { entries.push({ number, documentDate: null, typeLabel: null, subject: null, checksum: null, state: protectedType ? 'protected' : 'noAccess', fileName: null }); continue; }
      const base = { number, documentDate: row.documentDate, typeLabel: documentTypeFor(deps.db, row.typeKey)?.label ?? row.typeKey, subject: row.subject, checksum: row.fileChecksum };
      const checked = row.fileName ? await checkDocumentFile(deps, ctx, row) : { state: 'missing' as const };
      if (checked.state !== 'ok') { entries.push({ ...base, state: checked.state === 'altered' ? 'altered' : 'missing', fileName: null }); continue; }
      await add(`${number}.pdf`, checked.bytes!);
      entries.push({ ...base, state: row.status === 'voided' ? 'voided' : 'ok', fileName: `${number}.pdf` });
    }

    await add('inhaltsverzeichnis.csv', new TextEncoder().encode(bundleCsv(entries)));

    const prepared = await prepare(deps, ctx, { templateKey: 'dms-bundle-index', input: { title, entries } });
    if (!prepared.ok) throw new BundleFailed(prepared);
    const { built, baseId, bodyTypst } = prepared.value;
    const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context: await buildContext(deps, ctx, '') });
    await add('Inhaltsverzeichnis.pdf', bytes);

    zip.end();
    out.end();
    await once(out, 'finish');
    if (stream.failed) throw stream.failed;

    const included = entries.filter((e) => e.fileName !== null).length;
    deps.db.transaction((tx: DbOrTx) => {
      // Nummern, nie Betreffe: Das Protokoll ist unlöschbar und durchsuchbar.
      recordAudit(tx, deps, ctx, { action: 'dms.export', entityType: 'documentBundle', entityId: filename, after: { numbers: entries.map((e) => e.number), included, listedOnly: entries.length - included }, summary: `Bündel mit ${included} von ${entries.length} Dokumenten gezogen` });
    });
    return ok({ archivePath, filename, included, listedOnly: entries.length - included });
  } catch (error) {
    out.destroy();
    await rm(archivePath, { force: true });
    if (error instanceof BundleFailed) return error.failure;
    throw error;
  }
}

class BundleFailed extends Error {
  constructor(readonly failure: Extract<Result<never>, { ok: false }>) { super('bundle failed'); }
}
