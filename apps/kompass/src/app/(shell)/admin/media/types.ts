export interface Reference {
  label: string;
  href?: string;
}

export interface Item {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploadedBy: string | null;
  folder: string | null;
  references: Reference[];
}

export interface Folder {
  path: string;
  assetCount: number;
}

export interface ListQuery {
  folder: string | null;
  q: string;
  kind: 'all' | 'image' | 'pdf';
  sort: 'newest' | 'oldest' | 'name' | 'size';
}

/** Die URL der Mediathek für einen Zustand; leere Werte fallen weg. */
export function mediaHref(query: ListQuery): string {
  const params = new URLSearchParams();
  if (query.folder !== null) params.set('folder', query.folder);
  if (query.q) params.set('q', query.q);
  if (query.kind !== 'all') params.set('kind', query.kind);
  if (query.sort !== 'newest') params.set('sort', query.sort);
  const s = params.toString();
  return s ? `/admin/media?${s}` : '/admin/media';
}

export function formatBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}
