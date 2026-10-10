import type { PhotoCrop } from '../schema';
import type { AnimalPhoto } from '../service';
import { sameValue, type ProposalImageRow } from './model';

export interface PhotoRow {
  /** `image:<id>` für bereitgestellte Bilder, `media:<id>` für Fotos des Tiers. */
  key: string;
  imageId: string | null;
  mediaId: string | null;
  /** `source`: kam von dieser Quelle (bereitgestellt oder `sourceUserId` am Foto); `kompass`: anderswoher. */
  origin: 'source' | 'kompass';
  change: 'new' | 'kept' | 'dropped';
  /** Vorauswahl der Prüfung: neu und genannt → übernehmen; von der Quelle, nicht mehr genannt → entfernen; aus Kompass → behalten (A12). */
  defaultSelected: boolean;
  inProposal: boolean;
  proposedPrimary: boolean;
  currentPrimary: boolean;
  crop: PhotoCrop | null;
  sourceRef: string | null;
  width: number | null;
  height: number | null;
}
export interface PhotoChoice {
  imageId?: string;
  mediaId?: string;
  isPrimary: boolean;
  crop?: PhotoCrop | null;
}

/**
 * Die Fotozeilen einer Prüfung: erst die Einträge des Vorschlags in ihrer Reihenfolge, dann die Fotos des Tiers,
 * die der Vorschlag nicht nennt — aus Kompass (bleiben) vor denen der Quelle (fallen weg). `current === null`
 * heißt neuer Hund: nur die Einträge.
 */
export function photoRows(sourceUserId: string, entries: readonly ProposalImageRow[], current: readonly AnimalPhoto[] | null): PhotoRow[] {
  const byAsset = new Map((current ?? []).map((p) => [p.assetId, p]));
  const sorted = [...entries].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const rows: PhotoRow[] = sorted.map((e) => {
    if (e.mediaId === null) {
      return { key: `image:${e.id}`, imageId: e.id, mediaId: null, origin: 'source', change: 'new', defaultSelected: true, inProposal: true, proposedPrimary: e.isPrimary, currentPrimary: false, crop: e.crop ?? null, sourceRef: e.sourceRef, width: e.width, height: e.height };
    }
    const photo = byAsset.get(e.mediaId);
    return {
      key: `media:${e.mediaId}`,
      imageId: null,
      mediaId: e.mediaId,
      origin: !photo || photo.sourceUserId === sourceUserId ? 'source' : 'kompass',
      change: 'kept',
      defaultSelected: true,
      inProposal: true,
      proposedPrimary: e.isPrimary,
      currentPrimary: photo?.isPrimary ?? false,
      // Ohne Ausschnitt im Vorschlag bleibt der gespeicherte des Fotos.
      crop: e.crop ?? photo?.crop ?? null,
      sourceRef: e.sourceRef ?? photo?.sourceRef ?? null,
      width: e.width,
      height: e.height,
    };
  });
  const named = new Set(sorted.flatMap((e) => (e.mediaId ? [e.mediaId] : [])));
  const rest = (current ?? []).filter((p) => !named.has(p.assetId));
  const restRow = (p: AnimalPhoto, fromSource: boolean): PhotoRow => ({
    key: `media:${p.assetId}`,
    imageId: null,
    mediaId: p.assetId,
    origin: fromSource ? 'source' : 'kompass',
    change: fromSource ? 'dropped' : 'kept',
    defaultSelected: !fromSource,
    inProposal: false,
    proposedPrimary: false,
    currentPrimary: p.isPrimary,
    crop: p.crop,
    sourceRef: p.sourceRef,
    width: null,
    height: null,
  });
  rows.push(...rest.filter((p) => p.sourceUserId !== sourceUserId).map((p) => restRow(p, false)));
  rows.push(...rest.filter((p) => p.sourceUserId === sourceUserId).map((p) => restRow(p, true)));
  return rows;
}

/** Die Vorauswahl als Fotoliste: Titelbild das vorgeschlagene, sonst das heutige, falls es bleibt, sonst keins (dann das erste). */
export function defaultPhotoChoice(rows: readonly PhotoRow[]): PhotoChoice[] {
  const selected = rows.filter((r) => r.defaultSelected);
  const primaryKey = selected.find((r) => r.proposedPrimary)?.key ?? selected.find((r) => r.currentPrimary)?.key ?? null;
  return selected.map((r) => {
    const isPrimary = r.key === primaryKey;
    if (!r.inProposal) return { mediaId: r.mediaId!, isPrimary }; // Foto aus Kompass: Ausschnitt bleibt
    return r.imageId ? { imageId: r.imageId, isPrimary, crop: r.crop } : { mediaId: r.mediaId!, isPrimary, crop: r.crop };
  });
}

const keyOf = (c: PhotoChoice): string => (c.imageId ? `image:${c.imageId}` : `media:${c.mediaId}`);

/** Weicht die Wahl vom Vorschlag ab? Fotos aus Kompass zählen nicht (sie behält man ohnehin, A12). */
export function photoChoiceDiffers(rows: readonly PhotoRow[], chosen: readonly PhotoChoice[]): boolean {
  const byKey = new Map(chosen.map((c) => [keyOf(c), c]));
  for (const row of rows) {
    const choice = byKey.get(row.key);
    if (row.inProposal && !choice) return true;
    if (row.change === 'dropped' && choice) return true;
    if (row.inProposal && row.proposedPrimary && !choice?.isPrimary) return true;
    if (row.inProposal && choice && choice.crop !== undefined && !sameValue(choice.crop, row.crop)) return true;
  }
  return false;
}
