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
  /** Der geöffnete Ordner; die Liste zeigt ihn samt Unterordnern (Spec § 9). */
  folder: string | null;
  /** „Ohne Ordner“: nur Dateien, die in keinem Ordner liegen (`?unfiled=1`); schließt `folder` aus. */
  unfiled: boolean;
  q: string;
  kind: 'all' | 'image' | 'pdf';
  sort: 'newest' | 'oldest' | 'name' | 'size';
}

/** Die URL der Mediathek für einen Zustand; leere Werte fallen weg. */
export function mediaHref(query: ListQuery): string {
  const params = new URLSearchParams();
  if (query.unfiled) params.set('unfiled', '1');
  else if (query.folder !== null) params.set('folder', query.folder);
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

/**
 * So viele Dateien zeigt die Mediathek auf einmal — wie die Akte. Mit 1546
 * Dateien lud „Alle Dateien“ auf dem NAS 7 s (Befund 0.2.4/10); wer mehr sucht,
 * grenzt mit Ordner, Suche oder Art ein.
 */
export const MEDIA_LIST_LIMIT = 200;

/** Die ersten `MEDIA_LIST_LIMIT` Einträge in ihrer Reihenfolge und wie viele es insgesamt sind. */
export function capItems<T>(items: readonly T[]): { shown: T[]; matching: number } {
  return { shown: items.slice(0, MEDIA_LIST_LIMIT), matching: items.length };
}
