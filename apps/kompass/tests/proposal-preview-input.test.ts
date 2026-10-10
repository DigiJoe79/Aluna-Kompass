import { describe, expect, it } from 'vitest';
import { foreignPreviewPhotos, pagePathOf, previewKey, previewRowInput, PROPOSAL_ASSET_PREFIX } from '@/app/(shell)/animals/proposals/preview';

const photoRow = (o: Record<string, unknown>) => ({ key: '', imageId: null, mediaId: null, origin: 'source', change: 'new', defaultSelected: true, inProposal: true, proposedPrimary: false, currentPrimary: false, crop: null, sourceRef: null, width: 800, height: 600, conflict: false, ...o });
const review = (o: Record<string, unknown> = {}) =>
  ({
    proposal: { id: 'P1', kind: 'update', values: { sizeCm: 55, summary: { de: 'Neu.' } } },
    animal: { id: 'A1', photos: [{ assetId: 'M1', isPrimary: true }] },
    fields: [
      { field: 'sizeCm', proposed: 55, conflict: null },
      { field: 'summary', proposed: { de: 'Neu.' }, conflict: { changedBy: null } },
    ],
    photos: [photoRow({ key: 'image:I1', imageId: 'I1', proposedPrimary: true }), photoRow({ key: 'media:M1', mediaId: 'M1', inProposal: false, origin: 'kompass', change: 'kept', currentPrimary: true })],
    ...o,
  }) as never;

describe('previewRowInput (Vorschau „Heute“ / „Mit Wahl“)', () => {
  it('shows today without values and with today\'s photos', () => {
    expect(previewRowInput(review(), 'current', {})).toEqual({ animalId: 'A1', slugId: 'P1', values: {}, photos: [{ assetId: 'M1', isPrimary: true }], proposalImages: [] });
  });

  it('takes the proposal where chosen, today on conflict by default, and the chosen photos', () => {
    const input = previewRowInput(review(), 'choice', {});
    expect(input.values).toEqual({ sizeCm: 55 });
    expect(input.photos).toEqual([{ assetId: `${PROPOSAL_ASSET_PREFIX}I1`, isPrimary: true }, { assetId: 'M1', isPrimary: false }]);
    expect(input.proposalImages).toEqual(['I1']);
    expect(previewRowInput(review(), 'choice', { fields: { summary: 'proposal', sizeCm: 'current' }, photos: [{ mediaId: 'M1', isPrimary: true }] })).toMatchObject({ values: { summary: { de: 'Neu.' } }, photos: [{ assetId: 'M1', isPrimary: true }], proposalImages: [] });
  });

  it('takes all values for a new dog', () => {
    const input = previewRowInput(review({ proposal: { id: 'P2', kind: 'create', values: { name: 'Lotte' } }, animal: null, photos: [] }), 'choice', {});
    expect(input).toEqual({ animalId: null, slugId: 'P2', values: { name: 'Lotte' }, photos: [], proposalImages: [] });
  });

  it('admits only photos of the proposal or the animal from the client (M5)', () => {
    expect(foreignPreviewPhotos(review(), {})).toBe(false);
    expect(foreignPreviewPhotos(review(), { photos: [{ imageId: 'I1', isPrimary: true }, { mediaId: 'M1', isPrimary: false }] })).toBe(false);
    expect(foreignPreviewPhotos(review(), { photos: [{ imageId: 'I9', isPrimary: true }] })).toBe(true);
    expect(foreignPreviewPhotos(review(), { photos: [{ mediaId: 'M9', isPrimary: true }] })).toBe(true);
    // Ohne Fotoplan nimmt die Vorschau die heutigen Fotos und überhört die Liste des Clients.
    expect(foreignPreviewPhotos(review({ photos: null }), { photos: [{ mediaId: 'M9', isPrimary: true }] })).toBe(false);
  });

  it('keys a build by what it shows and finds the page from the profile address', () => {
    expect(previewKey('P1', { a: 1 })).toMatch(/^[a-f0-9]{24}$/);
    expect(previewKey('P1', { a: 1 })).toBe(previewKey('P1', { a: 1 }));
    expect(previewKey('P1', { a: 2 })).not.toBe(previewKey('P1', { a: 1 }));
    expect(pagePathOf('https://verein.example/hunde/{slug}/', 'lotte-abcd')).toBe('hunde/lotte-abcd/');
    expect(pagePathOf('', 'lotte-abcd')).toBe('');
  });
});
