import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { renderMarkdownTypst } from '@kompass/markdown';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { documents, mediaAssets, mediaFolders } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { storeMediaInternal } from '../media/service';
import type { DocumentBuildResult, DocumentRenderContext, DocumentTemplate } from '../modules/manifest';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { readAllSettings, readSetting } from '../settings/service';
import { resolveActiveTheme } from '../themes/service';
import { validate } from '../validate';

export type DocumentRecord = Omit<typeof documents.$inferSelect, 'inputSnapshot'> & { inputSnapshot: unknown };

const toRecord = (row: typeof documents.$inferSelect): DocumentRecord => ({ ...row, inputSnapshot: JSON.parse(row.inputSnapshot) });

export function nextDocumentNumber(db: DbOrTx, prefix: string, year: number): string {
  const row = db
    .select({ n: count() })
    .from(documents)
    .where(sql`${documents.number} like ${`${prefix}-${year}-%`}`)
    .get();
  return `${prefix}-${year}-${String((row?.n ?? 0) + 1).padStart(3, '0')}`;
}

const renderSchema = z.object({
  templateKey: z.string().min(1),
  input: z.unknown(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
});

async function buildContext(deps: Deps, ctx: CallContext, number: string): Promise<DocumentRenderContext> {
  const all = readAllSettings(deps);
  const organization = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('organization.')));
  const logoId = readSetting<string | null>(deps, 'branding.logoAssetId');
  let logo: DocumentRenderContext['logo'] = null;
  if (logoId) {
    const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, logoId)).get();
    if (asset) logo = { bytes: await deps.media.read(asset.filename), mimeType: asset.mimeType };
  }
  return { number, issuedAt: isoNow(deps.clock), organization, theme: resolveActiveTheme(deps), logo };
}

const DOCUMENT_FOLDER = 'Dokumente';

/** Legt den Mediathek-Ordner „Dokumente" an, falls er noch fehlt (auditiert). */
function ensureDocumentFolder(deps: Deps, ctx: CallContext): void {
  const exists = deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(eq(mediaFolders.path, DOCUMENT_FOLDER)).get();
  if (exists) return;
  deps.db.transaction((tx: DbOrTx) => {
    tx.insert(mediaFolders).values({ path: DOCUMENT_FOLDER, createdAt: isoNow(deps.clock) }).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.folder.create',
      entityType: 'mediaFolder',
      entityId: DOCUMENT_FOLDER,
      after: { path: DOCUMENT_FOLDER },
      summary: `Ordner „${DOCUMENT_FOLDER}" für erzeugte Dokumente angelegt`,
    });
  });
}

/** Vorgabe der Vorlage, überschrieben von `build()` und von `documents.bases`. */
function resolveBaseId(deps: Deps, template: DocumentTemplate, fromBuild: string | undefined): string {
  const configured = readSetting<Record<string, string>>(deps, 'documents.bases')[template.key];
  return configured ?? fromBuild ?? template.base;
}

/** Vorlage auflösen, Rechte und Eingabe prüfen, Körper und Basis bestimmen — gemeinsam für Akteneintrag und Auszug. */
async function prepare(
  deps: Deps,
  ctx: CallContext,
  parsedInput: z.infer<typeof renderSchema>,
): Promise<Result<{ template: DocumentTemplate; data: unknown; built: DocumentBuildResult; baseId: string; base: { checksum: string }; bodyTypst: string }>> {
  const template = deps.registry.documentTemplates.get(parsedInput.templateKey) as DocumentTemplate | undefined;
  if (!template) return notFound('documentTemplate', parsedInput.templateKey);
  if (template.permission) {
    const extra = requirePermission(ctx, template.permission);
    if (extra) return extra;
  }
  const data = validate(deps, template.schema, parsedInput.input);
  if (!data.ok) return data;

  const built = template.build(data.value, await buildContext(deps, ctx, 'PENDING'));
  const baseId = resolveBaseId(deps, template, built.base);
  const base = deps.documents.base(baseId);
  if (!base) return conflict('documentBaseUnavailable', `Basis-Vorlage „${baseId}" ist nicht verfügbar`);

  const bodyTypst = 'markdown' in built.body ? await renderMarkdownTypst(built.body.markdown) : built.body.typst;
  return ok({ template, data: data.value, built, baseId, base, bodyTypst });
}

/**
 * Ein Ad-hoc-Auszug: rendern und zurückgeben. Keine Nummer, keine Zeile in
 * `documents`, keine Ablage in der Mediathek — nur ein Eintrag im
 * Änderungsprotokoll, denn der Vorgang ist das Ziehen, nicht die Datei.
 */
export async function exportDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; mimeType: string }>> {
  const denied = requirePermission(ctx, 'documents.create');
  if (denied) return denied;
  const parsed = validate(deps, renderSchema, input);
  if (!parsed.ok) return parsed;
  const prepared = await prepare(deps, ctx, parsed.value);
  if (!prepared.ok) return prepared;
  const { template, built, baseId, bodyTypst } = prepared.value;
  if (template.filed !== false) {
    return conflict('documentIsFiled', `Vorlage „${template.key}" ist ein Akteneintrag und wird über renderDocument erzeugt`);
  }

  const context = await buildContext(deps, ctx, '');
  const bytes = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context });
  const filename = `${(built.slots.title ?? template.key).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || template.key}.pdf`;
  deps.db.transaction((tx: DbOrTx) => {
    recordAudit(tx, deps, ctx, {
      action: 'documents.export',
      entityType: 'documentTemplate',
      entityId: template.key,
      after: { templateKey: template.key, base: baseId },
      summary: `Auszug „${built.slots.title ?? template.key}" aus Vorlage ${template.key} gezogen`,
    });
  });
  return ok({ bytes, filename, mimeType: 'application/pdf' });
}

export async function renderDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'documents.create');
  if (denied) return denied;
  const parsed = validate(deps, renderSchema, input);
  if (!parsed.ok) return parsed;
  const prepared = await prepare(deps, ctx, parsed.value);
  if (!prepared.ok) return prepared;
  const { template, data, built, baseId, base, bodyTypst } = prepared.value;
  if (template.filed === false) {
    return conflict('documentNotFiled', `Vorlage „${template.key}" ist ein Ad-hoc-Auszug und wird über exportDocument gezogen`);
  }

  // Nummer reservieren: rendern außerhalb der Transaktion (async), Eindeutigkeit über den Unique-Index; bei Kollision erneut versuchen.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const year = deps.clock.now().getUTCFullYear();
    const number = nextDocumentNumber(deps.db, template.prefix, year);
    const context = await buildContext(deps, ctx, number);
    const bytes = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context });
    ensureDocumentFolder(deps, ctx);
    const asset = await storeMediaInternal(deps, ctx, { originalName: `${number}.pdf`, bytes, declaredMimeType: 'application/pdf', folder: DOCUMENT_FOLDER });
    if (!asset.ok) return asset;
    const snapshot = { input: data, slots: built.slots, base: baseId, baseChecksum: base.checksum };
    try {
      return deps.db.transaction((tx: DbOrTx) => {
        const id = newId();
        tx.insert(documents)
          .values({
            id,
            templateKey: template.key,
            number,
            entityType: parsed.value.entityType ?? null,
            entityId: parsed.value.entityId ?? null,
            inputSnapshot: JSON.stringify(snapshot),
            assetId: asset.value.id,
            status: 'issued',
            createdByUserId: ctx.userId as string,
            createdAt: context.issuedAt,
          })
          .run();
        const record = toRecord(tx.select().from(documents).where(eq(documents.id, id)).get()!);
        recordAudit(tx, deps, ctx, { action: 'documents.render', entityType: 'document', entityId: id, after: { number, templateKey: template.key, base: baseId, entityType: record.entityType, entityId: record.entityId }, summary: `Dokument ${number} erzeugt` });
        return ok(record);
      });
    } catch (error) {
      if (!(error instanceof Error && /UNIQUE constraint failed: documents.number/.test(error.message))) throw error;
    }
  }
  return conflict('documentNumberContention', 'Dokumentnummer konnte nicht reserviert werden');
}

export async function listDocumentBases(
  deps: Deps,
  ctx: CallContext,
): Promise<Result<{ id: string; label: string; kind: string; ok: boolean; error?: string }[]>> {
  const denied = requirePermission(ctx, 'documents.view');
  if (denied) return denied;
  const out = [];
  for (const base of deps.documents.bases()) {
    const probe = await deps.documents.probe(base.id);
    out.push({ id: base.id, label: base.label, kind: base.kind, ok: probe.ok, error: probe.ok ? undefined : probe.error });
  }
  return ok(out.sort((a, b) => a.id.localeCompare(b.id)));
}

const voidSchema = z.object({ id: z.string().min(1), reason: z.string().trim().min(1).max(300) });

export async function voidDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'documents.create');
  if (denied) return denied;
  const parsed = validate(deps, voidSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  if (row.status === 'voided') return conflict('documentAlreadyVoided', `Dokument ${row.number} ist bereits storniert`);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents).set({ status: 'voided', voidedAt: isoNow(deps.clock), voidedByUserId: ctx.userId, voidReason: parsed.value.reason }).where(eq(documents.id, row.id)).run();
    const after = toRecord(tx.select().from(documents).where(eq(documents.id, row.id)).get()!);
    recordAudit(tx, deps, ctx, { action: 'documents.void', entityType: 'document', entityId: row.id, before: { status: 'issued' }, after: { status: 'voided', reason: parsed.value.reason }, summary: `Dokument ${row.number} storniert: ${parsed.value.reason}` });
    return ok(after);
  });
}

const listSchema = z.object({
  templateKey: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export async function listDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ documents: DocumentRecord[]; total: number }>> {
  const denied = requirePermission(ctx, 'documents.view');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const conditions: SQL[] = [];
  if (q.templateKey) conditions.push(eq(documents.templateKey, q.templateKey));
  if (q.entityType) conditions.push(eq(documents.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(documents.entityId, q.entityId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = deps.db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;
  const rows = deps.db.select().from(documents).where(where).orderBy(desc(documents.createdAt), desc(documents.number)).limit(q.limit).offset(q.offset).all();
  return ok({ documents: rows.map(toRecord), total });
}

export async function getDocument(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: DocumentRecord; bytes: Uint8Array; filename: string }>> {
  const denied = requirePermission(ctx, 'documents.view');
  if (denied) return denied;
  const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return notFound('document', id);
  const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, row.assetId)).get();
  if (!asset) return notFound('mediaAsset', row.assetId);
  return ok({ record: toRecord(row), bytes: await deps.media.read(asset.filename), filename: `${row.number}.pdf` });
}
