type Photo = { assetId: string; isPrimary: boolean };

/**
 * Neue IDs hängen hinten an, abgewählte fallen weg, die Reihenfolge der
 * bleibenden bleibt. Das Hauptfoto bleibt, wenn es noch dabei ist, sonst
 * wird das erste zum Hauptfoto. Reine Funktion, ohne React — so bleibt sie
 * ohne next-intl/sonner-Importe direkt in Vitest testbar.
 */
export function mergePhotos(current: Photo[], chosen: string[]): Photo[] {
  const keep = current.filter((p) => chosen.includes(p.assetId));
  const known = new Set(keep.map((p) => p.assetId));
  const added = chosen.filter((id) => !known.has(id)).map((assetId) => ({ assetId, isPrimary: false }));
  const next = [...keep, ...added];
  if (next.length > 0 && !next.some((p) => p.isPrimary)) next[0] = { ...next[0]!, isPrimary: true };
  return next;
}
