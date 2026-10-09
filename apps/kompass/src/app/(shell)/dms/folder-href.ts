/** Was ein Ordnerklick mitnimmt: Ordner sind Ort, keine Filter (Spec Filterleisten § 3, wie `hrefFor` der Mediathek). */
const KEPT_ON_FOLDER_CHANGE = ['text', 'direction', 'type', 'phase', 'unsent', 'followUp', 'sort', 'dir'] as const;

export function folderHref(params: URLSearchParams, place: { folder: string | null; inbox?: boolean }): string {
  const next = new URLSearchParams();
  for (const key of KEPT_ON_FOLDER_CHANGE) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  if (place.inbox) next.set('inbox', '1');
  else if (place.folder !== null) next.set('folder', place.folder);
  const qs = next.toString();
  return qs ? `/dms?${qs}` : '/dms';
}
