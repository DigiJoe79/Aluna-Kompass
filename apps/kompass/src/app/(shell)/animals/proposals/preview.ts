import { createHash } from 'node:crypto';
import { defaultPhotoChoice, type PhotoChoice, type ProposalReview } from '@kompass/module-animals';

/** Bilder der Zwischenablage stehen in der Vorschau unter einer eigenen Kennung, nicht als Asset der Mediathek. */
export const PROPOSAL_ASSET_PREFIX = 'proposal-image-';

export interface PreviewChoice {
  fields?: Record<string, 'proposal' | 'current'>;
  photos?: PhotoChoice[];
}

/**
 * Was die Vorschau baut (Board Vorschläge 7b): „Heute“ ist der Hund wie gespeichert, „Mit Wahl“ der Hund mit den
 * gewählten Feldern und Fotos — ohne Angabe die Vorauswahl der Prüfseite (bei Konflikt heute). Ein neuer Hund hat
 * nur „Mit Wahl“: alle Werte des Vorschlags.
 */
export function previewRowInput(review: ProposalReview, side: 'current' | 'choice', choice: PreviewChoice) {
  const { proposal, animal } = review;
  const own = (animal?.photos ?? []).map((p) => ({ assetId: p.assetId, isPrimary: p.isPrimary }));
  if (side === 'current') return { animalId: animal?.id ?? null, slugId: proposal.id, values: {}, photos: own, proposalImages: [] as string[] };
  const values: Record<string, unknown> =
    proposal.kind === 'create'
      ? { ...(proposal.values ?? {}) }
      : Object.fromEntries(review.fields.filter((f) => (choice.fields?.[f.field] ?? (f.conflict ? 'current' : 'proposal')) === 'proposal').map((f) => [f.field, f.proposed]));
  const rows = review.photos ?? [];
  const picked: PhotoChoice[] = choice.photos ?? defaultPhotoChoice(rows);
  const photos = review.photos ? picked.map((c) => ({ assetId: c.imageId ? `${PROPOSAL_ASSET_PREFIX}${c.imageId}` : c.mediaId!, isPrimary: c.isPrimary })) : own;
  const proposalImages = review.photos ? picked.flatMap((c) => (c.imageId ? [c.imageId] : [])) : [];
  return { animalId: animal?.id ?? null, slugId: proposal.id, values, photos, proposalImages };
}

/**
 * Nennt die Wahl des Clients ein Foto, das weder zum Vorschlag noch zum Tier gehört (M5)? Dann baut die Vorschau
 * nicht — sonst läse sie ein fremdes Bild der Zwischenablage oder ein beliebiges Medium in die Seite. Ohne Fotoplan
 * zählt die Liste nicht (die Vorschau nimmt die heutigen Fotos).
 */
export function foreignPreviewPhotos(review: ProposalReview, choice: PreviewChoice): boolean {
  if (!review.photos || !choice.photos) return false;
  const keys = new Set(review.photos.map((r) => r.key));
  return choice.photos.some((c) => !keys.has(c.imageId ? `image:${c.imageId}` : `media:${c.mediaId}`));
}

/**
 * Ein Bau je Inhalt: Gleiche Wahl findet den fertigen Ordner wieder.
 * Bewusst in Kauf genommen (Review Plan B, M6): Der Schlüssel kennt nur Vorschlag, Seite, Zeile und Bilder — nicht
 * Vorlage, Variablen oder die übrigen Inhalte. Ändert sich dort etwas, zeigt eine schon gebaute Vorschau es bis zu
 * einer Stunde nicht (dann räumt `pruneOld` den Ordner weg). Und `pruneOld` misst am mtime des Ordners, den ein
 * Treffer nicht auffrischt: Eine knapp eine Stunde alte Seite kann ein paralleler Bau löschen, während der Rahmen
 * noch ihre Bilder lädt. Beides trifft nur eine Vorschau, nie die Webseite; ein Neuöffnen baut neu.
 */
export const previewKey = (id: string, shown: unknown): string => createHash('sha256').update(JSON.stringify({ id, shown })).digest('hex').slice(0, 24);

/** Der Pfad der Detailseite aus `animals.profileUrl` (ohne Host); ohne Vorlage die Startseite. */
export function pagePathOf(template: string, slug: string): string {
  if (!template.includes('{slug}')) return '';
  try {
    return new URL(template.split('{slug}').join(encodeURIComponent(slug))).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}
