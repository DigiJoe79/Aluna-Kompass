import { countUnfiledMediaAssets, listMediaAssets, listMediaFolders, mediaListFilterSchema, ok, type CallContext, type Deps, type MediaListFilter, type Result } from '@kompass/core';

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
  /** Alle Ordner; die Zahl zählt nur Dateien der gefragten Art (`kind`). */
  folders: { path: string; assetCount: number }[];
  /** Dateien der gefragten Art insgesamt — der Zähler an „Alle Dateien“. */
  total: number;
  /** Dateien der gefragten Art ohne Ordner — der Zähler an „Ohne Ordner“. */
  unfiledCount: number;
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

/**
 * Was der Auswahl-Dialog braucht: die gefilterte Liste und alle Ordner samt
 * Zählern, in einer Antwort. Die Zähler zählen nur die Art des Dialogs
 * (README § 3, Artboard 8). Ein geöffneter Ordner listet seinen Teilbaum,
 * damit die Liste so lang ist, wie der Baum zählt (Spec § 9).
 */
export async function buildMediaListing(deps: Deps, ctx: CallContext, filter: MediaListFilter): Promise<Result<MediaListing>> {
  const assets = await listMediaAssets(deps, ctx, { ...filter, includeSubfolders: typeof filter.folder === 'string' });
  if (!assets.ok) return assets;
  const folders = await listMediaFolders(deps, ctx, { kind: filter.kind });
  if (!folders.ok) return folders;
  const unfiled = await countUnfiledMediaAssets(deps, ctx, { kind: filter.kind });
  if (!unfiled.ok) return unfiled;
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
    total: unfiled.value + folders.value.reduce((sum, f) => sum + f.assetCount, 0),
    unfiledCount: unfiled.value,
  });
}
