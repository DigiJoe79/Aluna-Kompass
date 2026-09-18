import { listMediaAssets, listMediaFolders, mediaListFilterSchema, ok, type CallContext, type Deps, type MediaListFilter, type Result } from '@kompass/core';

export interface MediaListingItem {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  folder: string | null;
  references: { label: string; href?: string }[];
}

export interface MediaListing {
  items: MediaListingItem[];
  folders: { path: string; assetCount: number }[];
}

/**
 * Die Query-Parameter von `GET /media` als Filter. `folder=` (leer) heißt ohne
 * Ordner, weggelassen heißt alle — die Suchparameter kennen kein `null`.
 * `null` zurück heißt: ungültige Werte, der Handler antwortet 400.
 */
export function parseMediaListParams(params: URLSearchParams): MediaListFilter | null {
  const raw: Record<string, unknown> = {};
  if (params.has('folder')) raw.folder = params.get('folder') === '' ? null : params.get('folder');
  if (params.get('query')) raw.query = params.get('query');
  if (params.has('kind')) raw.kind = params.get('kind');
  if (params.has('sort')) raw.sort = params.get('sort');
  const parsed = mediaListFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Was der Auswahl-Dialog braucht: die gefilterte Liste und alle Ordner, in einer Antwort. */
export async function buildMediaListing(deps: Deps, ctx: CallContext, filter: MediaListFilter): Promise<Result<MediaListing>> {
  const assets = await listMediaAssets(deps, ctx, filter);
  if (!assets.ok) return assets;
  const folders = await listMediaFolders(deps, ctx);
  if (!folders.ok) return folders;
  return ok({
    items: assets.value.map(({ record, references }) => ({
      id: record.id,
      filename: record.filename,
      mimeType: record.mimeType,
      bytes: record.bytes,
      width: record.width,
      height: record.height,
      createdAt: record.createdAt,
      folder: record.folder,
      references: references.map((r) => (r.href ? { label: r.label, href: r.href } : { label: r.label })),
    })),
    folders: folders.value,
  });
}
