import {
  conflict,
  invalid,
  isoNow,
  newId,
  notFound,
  ok,
  parseFolderPath,
  readSetting,
  recordAudit,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { asc, count, eq, isNotNull, like } from 'drizzle-orm';
import { z } from 'zod';
import {
  documentFolders,
  documentRules,
  documents,
  documentTypes,
  type DocumentFolderRow,
  type DocumentRuleRow,
  type DocumentTypeRow,
} from './schema';

/**
 * **Beispiele für die Entwicklung**, nicht das, was das Produkt mitbringt.
 * Ausgeliefert werden nur die beiden unklassifizierten Arten aus `install.ts`;
 * Nummernkreise und Fristen sind Entscheidungen des Vereins. Diese Liste füllt
 * den Seed und die Tests, damit beide mit Vielfalt arbeiten.
 */
export const EXAMPLE_DOCUMENT_TYPES = [
  { key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true },
  { key: 'authority', label: 'Behördenschreiben', prefix: 'BEH', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'contract', label: 'Vertrag', prefix: 'VER', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'invoice', label: 'Rechnung', prefix: 'RCH', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'minutes', label: 'Protokoll', prefix: 'PRT', defaultDirection: 'outgoing', retentionClass: 'permanent', defaultFolder: null, isActive: true },
] as const;

export function documentTypeFor(db: DbOrTx, key: string): DocumentTypeRow | null {
  return db.select().from(documentTypes).where(eq(documentTypes.key, key)).get() ?? null;
}

/** Die Vorgabeart je Richtung — woraus die Formulare ihre Vorbelegung nehmen. */
export function defaultTypeKey(deps: Deps, direction: 'incoming' | 'outgoing'): string {
  return readSetting<string>(deps, direction === 'incoming' ? 'dms.defaultTypeIncoming' : 'dms.defaultTypeOutgoing');
}

export function isDefaultType(deps: Deps, key: string): boolean {
  return defaultTypeKey(deps, 'incoming') === key || defaultTypeKey(deps, 'outgoing') === key;
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

/**
 * Wie viele Dokumente in welchem Ordner liegen. Die Ordnerspalte der Akte
 * zeigt die Zahl neben dem Namen; ohne sie ist ein Ordner eine Behauptung.
 * Leere Ordner fehlen in der Antwort — dort steht dann keine Zahl.
 */
export async function countDocumentsByFolder(
  deps: Deps,
  ctx: CallContext,
): Promise<Result<Record<string, number>>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;

  const rows = deps.db
    .select({ folder: documents.folder, count: count() })
    .from(documents)
    .where(isNotNull(documents.folder))
    .groupBy(documents.folder)
    .all();

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.folder) counts[row.folder] = row.count;
  }
  return ok(counts);
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

export const documentTypeCreateSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(120),
  prefix: z.string().trim().regex(/^[A-Z]{3}$/),
  defaultDirection: z.enum(['outgoing', 'incoming']),
  retentionClass: z.enum(['permanent', 'statutory10Y', 'statutory6Y', 'consent']),
  defaultFolder: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const documentTypeUpdateSchema = z.object({
  key: z.string().min(1),
  label: z.string().trim().min(1).max(120).optional(),
  defaultDirection: z.enum(['outgoing', 'incoming']).optional(),
  retentionClass: z.enum(['permanent', 'statutory10Y', 'statutory6Y', 'consent']).optional(),
  defaultFolder: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function createDocumentType(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<DocumentTypeRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, documentTypeCreateSchema, input);
  if (!parsed.ok) return parsed;

  const existing = documentTypeFor(deps.db, parsed.value.key);
  if (existing) return conflict('documentTypeExists', `Dokumentart „${parsed.value.key}“ existiert bereits`);

  return deps.db.transaction((tx: DbOrTx) => {
    tx.insert(documentTypes)
      .values({
        key: parsed.value.key,
        label: parsed.value.label,
        prefix: parsed.value.prefix,
        defaultDirection: parsed.value.defaultDirection,
        retentionClass: parsed.value.retentionClass,
        defaultFolder: parsed.value.defaultFolder ?? null,
        isActive: true,
        sortOrder: parsed.value.sortOrder,
      })
      .run();

    recordAudit(tx, deps, ctx, {
      action: 'dms.type.create',
      entityType: 'documentType',
      entityId: parsed.value.key,
      after: { key: parsed.value.key, label: parsed.value.label, prefix: parsed.value.prefix },
      summary: `Dokumentart „${parsed.value.label}“ angelegt`,
    });

    const row = tx.select().from(documentTypes).where(eq(documentTypes.key, parsed.value.key)).get()!;
    return ok(row);
  });
}

export async function updateDocumentType(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<DocumentTypeRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, documentTypeUpdateSchema, input);
  if (!parsed.ok) return parsed;

  const existing = documentTypeFor(deps.db, parsed.value.key);
  if (!existing) return notFound('documentType', parsed.value.key);

  // Eine Art, auf die eine Vorgabe zeigt, darf nicht verschwinden — sonst steht
  // man beim nächsten Entwurf wieder vor einer leeren Auswahl.
  if (parsed.value.isActive === false && isDefaultType(deps, existing.key)) {
    return conflict('documentTypeIsDefault', `Dokumentart „${existing.label}“ ist als Vorgabe eingetragen`);
  }

  const updates: Partial<typeof documentTypes.$inferInsert> = {};
  if (parsed.value.label !== undefined) updates.label = parsed.value.label;
  if (parsed.value.defaultDirection !== undefined) updates.defaultDirection = parsed.value.defaultDirection;
  if (parsed.value.retentionClass !== undefined) updates.retentionClass = parsed.value.retentionClass;
  if (parsed.value.defaultFolder !== undefined) updates.defaultFolder = parsed.value.defaultFolder;
  if (parsed.value.isActive !== undefined) updates.isActive = parsed.value.isActive;
  if (parsed.value.sortOrder !== undefined) updates.sortOrder = parsed.value.sortOrder;

  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documentTypes).set(updates).where(eq(documentTypes.key, existing.key)).run();

    const after = tx.select().from(documentTypes).where(eq(documentTypes.key, existing.key)).get()!;
    recordAudit(tx, deps, ctx, {
      action: 'dms.type.update',
      entityType: 'documentType',
      entityId: existing.key,
      before: { label: existing.label, isActive: existing.isActive },
      after: { label: after.label, isActive: after.isActive },
      summary: `Dokumentart „${after.label}“ geändert`,
    });

    return ok(after);
  });
}

export const documentRuleCreateSchema = z.object({
  matchField: z.enum(['filename', 'senderName']),
  matchContains: z.string().trim().min(2).max(120),
  thenTypeKey: z.string().min(1).nullable().optional(),
  thenFolder: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const documentRuleUpdateSchema = z.object({
  id: z.string().min(1),
  matchField: z.enum(['filename', 'senderName']).optional(),
  matchContains: z.string().trim().min(2).max(120).optional(),
  thenTypeKey: z.string().min(1).nullable().optional(),
  thenFolder: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const documentRuleDeleteSchema = z.object({
  id: z.string().min(1),
});

export const documentRuleListSchema = z.object({
  includeInactive: z.boolean().default(false),
});

export async function createDocumentRule(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<DocumentRuleRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, documentRuleCreateSchema, input);
  if (!parsed.ok) return parsed;

  if (parsed.value.thenTypeKey) {
    const docType = documentTypeFor(deps.db, parsed.value.thenTypeKey);
    if (!docType) return notFound('documentType', parsed.value.thenTypeKey);
  }

  const id = newId();
  return deps.db.transaction((tx: DbOrTx) => {
    tx.insert(documentRules)
      .values({
        id,
        matchField: parsed.value.matchField,
        matchContains: parsed.value.matchContains,
        thenTypeKey: parsed.value.thenTypeKey ?? null,
        thenFolder: parsed.value.thenFolder ?? null,
        isActive: true,
        sortOrder: parsed.value.sortOrder,
      })
      .run();

    recordAudit(tx, deps, ctx, {
      action: 'dms.rule.create',
      entityType: 'documentRule',
      entityId: id,
      after: {
        matchField: parsed.value.matchField,
        matchContains: parsed.value.matchContains,
        thenTypeKey: parsed.value.thenTypeKey,
      },
      summary: `Einsortierregel für „${parsed.value.matchContains}“ angelegt`,
    });

    const row = tx.select().from(documentRules).where(eq(documentRules.id, id)).get()!;
    return ok(row);
  });
}

export async function updateDocumentRule(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<DocumentRuleRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, documentRuleUpdateSchema, input);
  if (!parsed.ok) return parsed;

  const existing = deps.db.select().from(documentRules).where(eq(documentRules.id, parsed.value.id)).get();
  if (!existing) return notFound('documentRule', parsed.value.id);

  if (parsed.value.thenTypeKey) {
    const docType = documentTypeFor(deps.db, parsed.value.thenTypeKey);
    if (!docType) return notFound('documentType', parsed.value.thenTypeKey);
  }

  const updates: Partial<typeof documentRules.$inferInsert> = {};
  if (parsed.value.matchField !== undefined) updates.matchField = parsed.value.matchField;
  if (parsed.value.matchContains !== undefined) updates.matchContains = parsed.value.matchContains;
  if (parsed.value.thenTypeKey !== undefined) updates.thenTypeKey = parsed.value.thenTypeKey;
  if (parsed.value.thenFolder !== undefined) updates.thenFolder = parsed.value.thenFolder;
  if (parsed.value.isActive !== undefined) updates.isActive = parsed.value.isActive;
  if (parsed.value.sortOrder !== undefined) updates.sortOrder = parsed.value.sortOrder;

  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documentRules).set(updates).where(eq(documentRules.id, existing.id)).run();

    const after = tx.select().from(documentRules).where(eq(documentRules.id, existing.id)).get()!;
    recordAudit(tx, deps, ctx, {
      action: 'dms.rule.update',
      entityType: 'documentRule',
      entityId: existing.id,
      before: { matchContains: existing.matchContains, isActive: existing.isActive },
      after: { matchContains: after.matchContains, isActive: after.isActive },
      summary: `Einsortierregel für „${after.matchContains}“ geändert`,
    });

    return ok(after);
  });
}

export async function deleteDocumentRule(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, documentRuleDeleteSchema, input);
  if (!parsed.ok) return parsed;

  const existing = deps.db.select().from(documentRules).where(eq(documentRules.id, parsed.value.id)).get();
  if (!existing) return notFound('documentRule', parsed.value.id);

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentRules).where(eq(documentRules.id, existing.id)).run();

    recordAudit(tx, deps, ctx, {
      action: 'dms.rule.delete',
      entityType: 'documentRule',
      entityId: existing.id,
      before: { matchContains: existing.matchContains, matchField: existing.matchField },
      summary: `Einsortierregel für „${existing.matchContains}“ gelöscht`,
    });

    return ok(null);
  });
}

export async function listDocumentRules(
  deps: Deps,
  ctx: CallContext,
  input: unknown = {},
): Promise<Result<DocumentRuleRow[]>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;

  const parsed = validate(deps, documentRuleListSchema, input ?? {});
  if (!parsed.ok) return parsed;

  const rows = deps.db
    .select()
    .from(documentRules)
    .orderBy(asc(documentRules.sortOrder), asc(documentRules.id))
    .all();

  return ok(parsed.value.includeInactive ? rows : rows.filter((r) => r.isActive));
}


