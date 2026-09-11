import { ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentTypes, type DocumentTypeRow } from './schema';

/**
 * Generischer Startsatz. Bewusst klein und ohne Vereinsspezifika (Prinzip 1) —
 * ein Verein legt seine eigenen Arten an.
 */
export const DEFAULT_DOCUMENT_TYPES = [
  { key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true },
  { key: 'authority', label: 'Behördenschreiben', prefix: 'BEH', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'contract', label: 'Vertrag', prefix: 'VER', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'invoice', label: 'Rechnung', prefix: 'RCH', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'minutes', label: 'Protokoll', prefix: 'PRT', defaultDirection: 'outgoing', retentionClass: 'permanent', defaultFolder: null, isActive: true },
] as const;

export function documentTypeFor(db: DbOrTx, key: string): DocumentTypeRow | null {
  return db.select().from(documentTypes).where(eq(documentTypes.key, key)).get() ?? null;
}

export const documentTypeListSchema = z.object({ includeInactive: z.boolean().default(false) });

export async function listDocumentTypes(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<DocumentTypeRow[]>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, documentTypeListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(documentTypes).orderBy(asc(documentTypes.sortOrder), asc(documentTypes.key)).all();
  return ok(parsed.value.includeInactive ? rows : rows.filter((row) => row.isActive));
}
