import {
  conflict,
  invalid,
  isoNow,
  notFound,
  ok,
  parseFolderPath,
  recordAudit,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { asc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import {
  documentFolders,
  documents,
  documentTypes,
  type DocumentFolderRow,
  type DocumentTypeRow,
} from './schema';

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

export const documentFolderCreateSchema = z.object({
  path: z.string().min(1),
});

export async function createDocumentFolder(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<DocumentFolderRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, documentFolderCreateSchema, input);
  if (!parsed.ok) return parsed;

  const path = parseFolderPath(parsed.value.path);
  if (!path) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);

  const existing = deps.db.select().from(documentFolders).where(eq(documentFolders.path, path)).get();
  if (existing) return conflict('folderExists', `Der Ordner „${path}“ existiert bereits`);

  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.insert(documentFolders).values({ path, createdAt: now }).run();
    recordAudit(tx, deps, ctx, {
      action: 'dms.folder.create',
      entityType: 'documentFolder',
      entityId: path,
      after: { path },
      summary: `Ordner „${path}“ angelegt`,
    });
    const row = tx.select().from(documentFolders).where(eq(documentFolders.path, path)).get()!;
    return ok(row);
  });
}

export async function listDocumentFolders(
  deps: Deps,
  ctx: CallContext,
): Promise<Result<DocumentFolderRow[]>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;

  const rows = deps.db.select().from(documentFolders).orderBy(asc(documentFolders.path)).all();
  return ok(rows);
}

export const documentFolderDeleteSchema = z.object({
  path: z.string().min(1),
});

export async function deleteDocumentFolder(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, documentFolderDeleteSchema, input);
  if (!parsed.ok) return parsed;

  const path = parseFolderPath(parsed.value.path);
  if (!path) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);

  const existing = deps.db.select().from(documentFolders).where(eq(documentFolders.path, path)).get();
  if (!existing) return notFound('documentFolder', path);

  const hasDoc = deps.db.select({ id: documents.id }).from(documents).where(eq(documents.folder, path)).get();
  const hasChild = deps.db.select({ path: documentFolders.path }).from(documentFolders).where(like(documentFolders.path, `${path}/%`)).get();
  if (hasDoc || hasChild) return conflict('folderNotEmpty', `Der Ordner „${path}“ ist nicht leer`);

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentFolders).where(eq(documentFolders.path, path)).run();
    recordAudit(tx, deps, ctx, {
      action: 'dms.folder.delete',
      entityType: 'documentFolder',
      entityId: path,
      before: { path },
      summary: `Ordner „${path}“ gelöscht`,
    });
    return ok(null);
  });
}

