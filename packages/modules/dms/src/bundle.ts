import { conflict, hasPermission, linkedAccess, ok, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isProtectedType, requireDmsGate, requireReadable } from './access';
import { documentTypeFor } from './catalog';
import { documentLinks, documents, type DocumentRow } from './schema';

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
