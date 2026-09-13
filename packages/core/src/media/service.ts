import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, like, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { mediaAssets } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import type { MediaReference } from '../modules/manifest';
import { conflict, invalid, notFound, ok, unauthorized, type Result } from '../result';
import { folderExists } from './folders';
import { ensurePreview, hasPreview, previewFilename, readImageMeta, renderPreview } from './preview';
import { findMediaReferences } from './references';

export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

export type MediaAssetRecord = typeof mediaAssets.$inferSelect;

export interface StoreMediaInput {
  originalName: string;
  bytes: Uint8Array;
  declaredMimeType?: string;
  /** Zielordner (Pfad aus media_folders) oder null/weggelassen = Wurzel.
   *  Bei einem Dedup-Treffer bleibt der Ordner des vorhandenen Datensatzes. */
  folder?: string | null;
}

function slug(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
}

async function detectMimeType(input: StoreMediaInput, trustDeclaredPdf: boolean = false): Promise<string | null> {
  const sniffed = await fileTypeFromBuffer(input.bytes);
  if (sniffed && EXTENSIONS[sniffed.mime]) return sniffed.mime;
  const head = new TextDecoder().decode(input.bytes.subarray(0, 512)).trimStart();
  if ((input.declaredMimeType === 'image/svg+xml' || input.originalName.toLowerCase().endsWith('.svg')) && (head.startsWith('<svg') || head.startsWith('<?xml'))) return 'image/svg+xml';
  // Deklarierte PDFs nur im internen Kanal (Dokument-Rendering, Import); bei Uploads zählt ausschließlich der Sniff.
  if (trustDeclaredPdf && input.declaredMimeType === 'application/pdf') return 'application/pdf';
  return null;
}

type Prepared = { mimeType: string; ext: string; hash: string; width: number | null; height: number | null; preview: Uint8Array | null };

async function prepare(input: StoreMediaInput, trustDeclaredPdf: boolean = false): Promise<Result<Prepared>> {
  if (input.bytes.byteLength > MEDIA_MAX_BYTES) return invalid([{ path: 'bytes', message: 'fileTooLarge' }]);
  const mimeType = await detectMimeType(input, trustDeclaredPdf);
  if (!mimeType) return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
  if (mimeType === 'image/svg+xml' && /<script|on[a-z]+\s*=|javascript:/i.test(new TextDecoder().decode(input.bytes))) {
    return invalid([{ path: 'bytes', message: 'svgContainsScript' }]);
  }
  let width: number | null = null;
  let height: number | null = null;
  let preview: Uint8Array | null = null;
  if (hasPreview(mimeType)) {
    // Maße und Vorschau entstehen hier, vor jedem Schreibzugriff: Ein Bild, das
    // sharp nicht lesen kann, wird abgelehnt, nicht halb abgelegt.
    try {
      ({ width, height } = await readImageMeta(input.bytes));
      preview = await renderPreview(input.bytes);
    } catch {
      return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
    }
  }
  return ok({ mimeType, ext: EXTENSIONS[mimeType] as string, hash: createHash('sha256').update(input.bytes).digest('hex'), width, height, preview });
}

/** Was `storeMedia*` zurückgibt, wenn der Aufrufer wissen muss, ob die Bytes neu waren. */
export interface StoredMedia {
  record: MediaAssetRecord;
  /** false = Dedup-Treffer: der Datensatz gab es schon, sein Ordner und Name bleiben. */
  created: boolean;
}

async function storeDetailed(deps: Deps, ctx: CallContext, input: StoreMediaInput, prepared?: Prepared): Promise<Result<StoredMedia>> {
  const prep = prepared ? ok(prepared) : await prepare(input, true);
  if (!prep.ok) return prep;
  const meta = prep.value;
  const filename = `${slug(input.originalName)}-${meta.hash.slice(0, 12)}.${meta.ext}`;
  // Dedupe am Inhalt: gleicher Hash (Suffix) ⇒ gleicher Datensatz, auch bei anderem Slug im Namen.
  const existing = deps.db
    .select()
    .from(mediaAssets)
    .where(sql`${mediaAssets.filename} like ${`%-${meta.hash.slice(0, 12)}.${meta.ext}`}`)
    .get();
  if (existing) return ok({ record: existing, created: false }); // Dedup: der Ordner des vorhandenen Datensatzes bleibt
  const folder = input.folder && folderExists(deps, input.folder) ? input.folder : null;
  await deps.media.write(filename, input.bytes);
  if (meta.preview) await deps.media.write(previewFilename(filename), meta.preview);
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(mediaAssets)
      .values({ id, filename, mimeType: meta.mimeType, bytes: input.bytes.byteLength, width: meta.width, height: meta.height, uploadedByUserId: ctx.userId, createdAt: isoNow(deps.clock), folder, checksum: meta.hash })
      .run();
    const record = tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get() as MediaAssetRecord;
    recordAudit(tx, deps, ctx, { action: 'media.upload', entityType: 'mediaAsset', entityId: id, after: record, summary: `Datei ${filename} abgelegt` });
    return ok({ record, created: true });
  });
}

const recordOnly = (r: Result<StoredMedia>): Result<MediaAssetRecord> => (r.ok ? ok(r.value.record) : r);

/** Ohne Rechteprüfung; für Dokument-Rendering und Import. Validiert und protokolliert trotzdem. */
export async function storeMediaInternal(deps: Deps, ctx: CallContext, input: StoreMediaInput, prepared?: Prepared): Promise<Result<MediaAssetRecord>> {
  return recordOnly(await storeDetailed(deps, ctx, input, prepared));
}

/** Wie `storeMediaAsset`, sagt aber dazu, ob die Datei neu war oder ein Dedup-Treffer. */
export async function storeMediaAssetDetailed(deps: Deps, ctx: CallContext, input: StoreMediaInput): Promise<Result<StoredMedia>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;
  return storeDetailed(deps, ctx, input, prepared.value);
}

export async function storeMediaAsset(deps: Deps, ctx: CallContext, input: StoreMediaInput): Promise<Result<MediaAssetRecord>> {
  return recordOnly(await storeMediaAssetDetailed(deps, ctx, input));
}

/**
 * Die Auslieferung einer einzelnen Datei. Bis hierher galt „angemeldet reicht“,
 * was für Arbeitsmaterial der Redaktion stimmt — Logo, Projektbild, Tierfoto
 * landen ohnehin auf der Webseite. Beansprucht ein Modul das Asset aber unter
 * einem Recht, gilt dieses Recht auch hier: Sonst stünde neben der geprüften
 * Tür des Moduls eine ungeprüfte daneben.
 */
/** Angemeldet, und wo ein Modul das Asset unter ein Recht stellt, dieses Recht. */
function loadReadable(deps: Deps, ctx: CallContext, id: string): Result<MediaAssetRecord> {
  if (!ctx.userId && ctx.channel !== 'system') return unauthorized('invalidCredentials');
  const record = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
  if (!record) return notFound('mediaAsset', id);
  if (ctx.channel !== 'system') {
    for (const reference of findMediaReferences(deps, record.id)) {
      if (!reference.permission) continue;
      const denied = requirePermission(ctx, reference.permission);
      if (denied) return denied;
    }
  }
  return ok(record);
}

export async function getMediaAsset(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: MediaAssetRecord; bytes: Uint8Array }>> {
  const loaded = loadReadable(deps, ctx, id);
  if (!loaded.ok) return loaded;
  const record = loaded.value;
  return ok({ record, bytes: await deps.media.read(record.filename) });
}

/**
 * Die Vorschau zu einem Asset, mit denselben Rechten wie das Original. Fehlt
 * die Datei, wird sie gebaut — ohne Protokolleintrag, es ist ein Cache.
 * `bytes` ist `null`, wenn es zu diesem Typ keine Vorschau gibt (PDF).
 */
export async function getMediaPreview(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: MediaAssetRecord; bytes: Uint8Array | null; contentType: string }>> {
  const loaded = loadReadable(deps, ctx, id);
  if (!loaded.ok) return loaded;
  const record = loaded.value;
  const bytes = await ensurePreview(deps, record);
  const contentType = record.mimeType === 'image/svg+xml' ? 'image/svg+xml' : 'image/webp';
  return ok({ record, bytes, contentType });
}

export interface MediaLibraryItem {
  record: MediaAssetRecord;
  references: MediaReference[];
}

export interface MediaListFilter {
  /** weggelassen = alle; null = ohne Ordner; Pfad = genau dieser Ordner */
  folder?: string | null;
  /** Teilstring ohne Groß-/Kleinschreibung im Dateinamen oder in einem Verwendungs-Label */
  query?: string;
  /** image umfasst PNG, JPEG, WebP und SVG; pdf nur PDF */
  kind?: 'image' | 'pdf';
  /** Vorgabe newest */
  sort?: 'newest' | 'oldest' | 'name' | 'size';
}

/** Ein Schema für alle Kanäle: MCP-Werkzeug, Route Handler, Seite. */
export const mediaListFilterSchema = z.object({
  folder: z.string().nullable().optional(),
  query: z.string().max(200).optional(),
  kind: z.enum(['image', 'pdf']).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'size']).optional(),
});

/**
 * Alle Assets mit ihren Fundstellen. Ordner und Typ filtern in SQL, die
 * Suche danach — die Labels entstehen erst durch `findMediaReferences`.
 */
export async function listMediaAssets(deps: Deps, ctx: CallContext, filter: MediaListFilter = {}): Promise<Result<MediaLibraryItem[]>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const conditions = [];
  if (filter.folder !== undefined) conditions.push(filter.folder === null ? isNull(mediaAssets.folder) : eq(mediaAssets.folder, filter.folder));
  if (filter.kind === 'image') conditions.push(like(mediaAssets.mimeType, 'image/%'));
  if (filter.kind === 'pdf') conditions.push(eq(mediaAssets.mimeType, 'application/pdf'));
  const order = {
    newest: [desc(mediaAssets.createdAt), desc(mediaAssets.id)],
    oldest: [asc(mediaAssets.createdAt), asc(mediaAssets.id)],
    name: [asc(mediaAssets.filename)],
    size: [desc(mediaAssets.bytes), asc(mediaAssets.filename)],
  }[filter.sort ?? 'newest'];
  const rows = deps.db.select().from(mediaAssets).where(conditions.length ? and(...conditions) : undefined).orderBy(...order).all();
  const items = rows.map((record) => ({ record, references: findMediaReferences(deps, record.id) }));
  const q = filter.query?.trim().toLowerCase();
  if (!q) return ok(items);
  return ok(items.filter((it) => it.record.filename.toLowerCase().includes(q) || it.references.some((r) => r.label.toLowerCase().includes(q))));
}

const deleteInput = z.object({ id: z.string().min(1) });

export async function deleteMediaAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = deleteInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));

  const record = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, parsed.data.id)).get();
  if (!record) return notFound('mediaAsset', parsed.data.id);

  const refs = findMediaReferences(deps, record.id);
  if (refs.length > 0) {
    return conflict('mediaAssetInUse', `Wird verwendet bei: ${refs.map((r) => r.label).join(', ')}. Entferne die Datei dort zuerst.`);
  }

  deps.db.transaction((tx) => {
    tx.delete(mediaAssets).where(eq(mediaAssets.id, record.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.delete',
      entityType: 'mediaAsset',
      entityId: record.id,
      before: record,
      summary: `Datei „${record.filename}“ gelöscht`,
    });
  });
  // Datei erst nach dem Commit; ein verwaister Rest wäre harmlos (Dedup nach Hash).
  await deps.media.delete(record.filename);
  await deps.media.delete(previewFilename(record.filename));
  return ok(null);
}