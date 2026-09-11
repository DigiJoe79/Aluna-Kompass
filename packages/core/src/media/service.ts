import { createHash } from 'node:crypto';
import { eq, isNull, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';
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
  const base = name.replace(/\.[^.]+$/, '').toLowerCase().normalize('NFKD').replace(/\u0300-\u036f/g, '');
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

type Prepared = { mimeType: string; ext: string; hash: string; width: number | null; height: number | null };

async function prepare(input: StoreMediaInput, trustDeclaredPdf: boolean = false): Promise<Result<Prepared>> {
  if (input.bytes.byteLength > MEDIA_MAX_BYTES) return invalid([{ path: 'bytes', message: 'fileTooLarge' }]);
  const mimeType = await detectMimeType(input, trustDeclaredPdf);
  if (!mimeType) return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
  if (mimeType === 'image/svg+xml' && /<script|on[a-z]+\s*=|javascript:/i.test(new TextDecoder().decode(input.bytes))) {
    return invalid([{ path: 'bytes', message: 'svgContainsScript' }]);
  }
  let width: number | null = null;
  let height: number | null = null;
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp') {
    try {
      const size = imageSize(input.bytes);
      width = size.width ?? null;
      height = size.height ?? null;
    } catch {
      return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
    }
  }
  return ok({ mimeType, ext: EXTENSIONS[mimeType] as string, hash: createHash('sha256').update(input.bytes).digest('hex'), width, height });
}

/** Ohne Rechteprüfung; für Dokument-Rendering und Import. Validiert und protokolliert trotzdem. */
export async function storeMediaInternal(deps: Deps, ctx: CallContext, input: StoreMediaInput, prepared?: Prepared): Promise<Result<MediaAssetRecord>> {
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
  if (existing) return ok(existing); // Dedup: der Ordner des vorhandenen Datensatzes bleibt
  const folder = input.folder && folderExists(deps, input.folder) ? input.folder : null;
  await deps.media.write(filename, input.bytes);
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(mediaAssets)
      .values({ id, filename, mimeType: meta.mimeType, bytes: input.bytes.byteLength, width: meta.width, height: meta.height, uploadedByUserId: ctx.userId, createdAt: isoNow(deps.clock), folder, checksum: meta.hash })
      .run();
    const record = tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get() as MediaAssetRecord;
    recordAudit(tx, deps, ctx, { action: 'media.upload', entityType: 'mediaAsset', entityId: id, after: record, summary: `Datei ${filename} abgelegt` });
    return ok(record);
  });
}

export async function storeMediaAsset(deps: Deps, ctx: CallContext, input: StoreMediaInput): Promise<Result<MediaAssetRecord>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;
  return storeMediaInternal(deps, ctx, input, prepared.value);
}

/**
 * Die Auslieferung einer einzelnen Datei. Bis hierher galt „angemeldet reicht",
 * was für Arbeitsmaterial der Redaktion stimmt — Logo, Projektbild, Tierfoto
 * landen ohnehin auf der Webseite. Beansprucht ein Modul das Asset aber unter
 * einem Recht, gilt dieses Recht auch hier: Sonst stünde neben der geprüften
 * Tür des Moduls eine ungeprüfte daneben.
 */
export async function getMediaAsset(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: MediaAssetRecord; bytes: Uint8Array }>> {
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
  return ok({ record, bytes: await deps.media.read(record.filename) });
}

export interface MediaLibraryItem {
  record: MediaAssetRecord;
  references: MediaReference[];
}

/**
 * Alle Assets (mit ihren Fundstellen). `folder` filtert: weggelassen = alle,
 * `null` = Wurzel, ein Pfad = genau dieser Ordner.
 */
export async function listMediaAssets(deps: Deps, ctx: CallContext, folder?: string | null): Promise<Result<MediaLibraryItem[]>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const where = folder === undefined ? undefined : folder === null ? isNull(mediaAssets.folder) : eq(mediaAssets.folder, folder);
  const rows = deps.db.select().from(mediaAssets).where(where).orderBy(mediaAssets.createdAt).all();
  return ok(rows.map((record) => ({ record, references: findMediaReferences(deps, record.id) })));
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
      summary: `Datei „${record.filename}" gelöscht`,
    });
  });
  // Datei erst nach dem Commit; ein verwaister Rest wäre harmlos (Dedup nach Hash).
  await deps.media.delete(record.filename);
  return ok(null);
}