import { photoChoiceDiffers } from '@kompass/module-animals';
import { describe, expect, it } from 'vitest';
import { photoChoices, photoChoicesDiffer, photosUnchanged, type ReviewPhotoRow } from '@/app/(shell)/animals/proposals/[id]/photo-review';

const row = (o: Partial<ReviewPhotoRow>): ReviewPhotoRow => ({ key: '', imageId: null, mediaId: null, origin: 'source', change: 'new', defaultSelected: true, inProposal: true, proposedPrimary: false, currentPrimary: false, crop: null, sourceRef: null, width: null, height: null, conflict: false, ...o });
const rows = [
  row({ key: 'image:I1', imageId: 'I1', proposedPrimary: true }),
  row({ key: 'media:K1', mediaId: 'K1', origin: 'kompass', change: 'kept', inProposal: false, currentPrimary: true }),
  row({ key: 'media:S1', mediaId: 'S1', change: 'dropped', inProposal: false, defaultSelected: false }),
];

/** „angenommen mit Änderungen“ im Dialog muss sagen, was der Dienst zurückmeldet (Reviewer I5). */
describe('photoChoicesDiffer mirrors the service rule', () => {
  const cases: [string, Record<string, boolean>, 'proposal' | 'current'][] = [
    ['preselection', { 'image:I1': true, 'media:K1': true, 'media:S1': false }, 'proposal'],
    ['Kompass photo deselected (A12: not a change)', { 'image:I1': true, 'media:K1': false, 'media:S1': false }, 'proposal'],
    ['new photo left out', { 'image:I1': false, 'media:K1': true, 'media:S1': false }, 'proposal'],
    ['dropped photo kept', { 'image:I1': true, 'media:K1': true, 'media:S1': true }, 'proposal'],
    ['primary kept today', { 'image:I1': true, 'media:K1': true, 'media:S1': false }, 'current'],
  ];
  for (const [name, selected, primary] of cases) {
    it(name, () => {
      const state = { selected, primary, crops: {}, removed: {} };
      expect(photoChoicesDiffer(rows, state)).toBe(photoChoiceDiffers(rows, photoChoices(rows, state)));
    });
  }
});

/**
 * „Annehmen“ ohne Wirkung (Befund 9): Bleibt die Fotoliste des Hundes, wie sie ist? Maßstab ist der Hund heute, nicht
 * der Vorschlag — wie `samePhotos` des Dienstes (Reihenfolge, Titelbild, Ausschnitt, neue Bilder).
 */
describe('photosUnchanged compares the choice with the animal today', () => {
  const today = [
    { assetId: 'K1', isPrimary: true, crop: null, sourceUserId: null, sourceRef: null },
    { assetId: 'S1', isPrimary: false, crop: null, sourceUserId: 'src', sourceRef: 'r1' },
  ];
  const keepAll = { 'image:I1': false, 'media:K1': true, 'media:S1': true };
  it('new photo left out, dropped photo kept, primary kept today → nothing changes', () => {
    expect(photosUnchanged(rows, { selected: keepAll, primary: 'current', crops: {}, removed: {} }, today)).toBe(true);
  });
  it('the preselection changes the photos', () => {
    expect(photosUnchanged(rows, { selected: { 'image:I1': true, 'media:K1': true, 'media:S1': false }, primary: 'proposal', crops: {}, removed: {} }, today)).toBe(false);
  });
  it('removing a photo is a change', () => {
    expect(photosUnchanged(rows, { selected: { ...keepAll, 'media:S1': false }, primary: 'current', crops: {}, removed: {} }, today)).toBe(false);
  });
  it('another order is a change', () => {
    expect(photosUnchanged(rows, { selected: keepAll, primary: 'current', crops: {}, removed: {} }, [today[1]!, today[0]!])).toBe(false);
  });
  it('another crop of a photo the proposal names is a change', () => {
    const named = [row({ key: 'media:K1', mediaId: 'K1', change: 'kept', currentPrimary: true, proposedPrimary: true, crop: { x: 0.1, y: 0, w: 0.8, h: 1 } })];
    expect(photosUnchanged(named, { selected: { 'media:K1': true }, primary: 'proposal', crops: {}, removed: {} }, [today[0]!])).toBe(false);
  });
});

/**
 * Ausschnitt in der Prüfung (Spec 2026-10-11 § 2.6): Die Wahl trägt den Ausschnitt jedes Fotos, auch eines aus
 * Kompass. Dort zählt er nicht als „mit Änderungen“ (A12), die Annehmen-Abfrage meldet „ändert das Tier“ trotzdem.
 */
describe('crop of a Kompass photo', () => {
  const CROP = { x: 0.1, y: 0, w: 0.8, h: 1 };
  const preselection = { 'image:I1': true, 'media:K1': true, 'media:S1': false };
  it('goes with the choice, the stored one when untouched', () => {
    const stored = [rows[0]!, { ...rows[1]!, crop: CROP }, rows[2]!];
    expect(photoChoices(stored, { selected: preselection, primary: 'proposal', crops: {}, removed: {} })).toContainEqual({ mediaId: 'K1', isPrimary: false, crop: CROP });
    expect(photoChoices(rows, { selected: preselection, primary: 'proposal', crops: { 'media:K1': CROP }, removed: {} })).toContainEqual({ mediaId: 'K1', isPrimary: false, crop: CROP });
  });
  it('is not a change against the proposal, in the client as in the service', () => {
    const state = { selected: preselection, primary: 'proposal' as const, crops: { 'media:K1': CROP }, removed: {} };
    expect(photoChoicesDiffer(rows, state)).toBe(false);
    expect(photoChoiceDiffers(rows, photoChoices(rows, state))).toBe(false);
  });
  it('but it changes the animal', () => {
    const today = [{ assetId: 'K1', isPrimary: true, crop: null, sourceUserId: null, sourceRef: null }];
    const only = [rows[1]!];
    expect(photosUnchanged(only, { selected: { 'media:K1': true }, primary: 'current', crops: {}, removed: {} }, today)).toBe(true);
    expect(photosUnchanged(only, { selected: { 'media:K1': true }, primary: 'current', crops: { 'media:K1': CROP }, removed: {} }, today)).toBe(false);
  });
  it('a crop changed at a photo of the proposal is a change', () => {
    const state = { selected: preselection, primary: 'proposal' as const, crops: { 'image:I1': CROP }, removed: {} };
    expect(photoChoicesDiffer(rows, state)).toBe(true);
    expect(photoChoiceDiffers(rows, photoChoices(rows, state))).toBe(true);
  });
});
