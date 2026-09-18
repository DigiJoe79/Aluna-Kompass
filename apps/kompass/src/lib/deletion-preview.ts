import type { DeletionPreview } from '@kompass/core';

/** Was der Löschdialog braucht — flach und serialisierbar, damit es durch eine Server Action passt. */
export interface DeletionPreviewView {
  isPublished: boolean;
  /** Halter (mit `until`) und Verweise (ohne), in dieser Reihenfolge. */
  blockers: { label: string; until?: string | null; href?: string }[];
  exclusiveMedia: number;
  sharedMedia: { filename: string; usedElsewhere: string[] }[];
  canDeleteMedia: boolean;
}

export function toDeletionPreviewView(preview: DeletionPreview, canDeleteMedia: boolean): DeletionPreviewView {
  return {
    isPublished: preview.isPublished,
    blockers: [
      ...preview.holds.map((h) => ({ label: h.label, until: h.until })),
      ...preview.references.map((r) => ({ label: r.label, ...(r.href ? { href: r.href } : {}) })),
    ],
    exclusiveMedia: preview.media.filter((m) => m.usedElsewhere.length === 0).length,
    sharedMedia: preview.media.filter((m) => m.usedElsewhere.length > 0).map((m) => ({ filename: m.filename, usedElsewhere: m.usedElsewhere })),
    canDeleteMedia,
  };
}
