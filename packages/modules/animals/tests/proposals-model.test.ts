import { describe, expect, it } from 'vitest';
import { baselineOf, canonical, conflictKeys, defaultPhotoChoice, photoChoiceDiffers, photoRows, proposalRuleIssues, proposalSubmitUnion, sameValue, type AnimalRecord, type ProposalImageRow } from '../src';

const animal = (over: Partial<AnimalRecord> = {}): AnimalRecord => ({ id: 'A1', slug: 'luna-a1a1', name: 'Luna', species: 'dog', sex: 'female', birthText: { de: '2022' }, sizeCm: 40, sizeText: { de: '40 cm' }, location: 'shelter', place: '', status: 'lookingForHome', isEmergency: false, isSponsorable: false, traits: {}, externalProfileUrl: '', summary: { de: 'Ruhig.' }, body: { de: 'Text' }, isPublished: false, reviewRequestedAt: null, reviewNote: '', createdAt: 't', updatedAt: 't', photos: [], story: null, ...over });
const img = (over: Partial<ProposalImageRow>): ProposalImageRow => ({ id: 'I', sourceUserId: 'S', proposalId: 'P', filename: 'p-i.png', mimeType: 'image/png', bytes: 1, width: 4, height: 5, checksum: 'c', sourceRef: null, position: 0, isPrimary: false, crop: null, mediaId: null, createdAt: 't', ...over });

/** Was der Dienst annimmt: die Union der Arten und die Regeln über mehrere Felder. */
const proposalSubmitSchema = {
  safeParse: (v: unknown) => {
    const r = proposalSubmitUnion.safeParse(v);
    return { success: r.success && proposalRuleIssues(r.data as Parameters<typeof proposalRuleIssues>[0]).length === 0 };
  },
};

describe('proposal model', () => {
  it('compares localized maps regardless of key order', () => {
    expect(sameValue({ de: 'a', en: 'b' }, { en: 'b', de: 'a' })).toBe(true);
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(canonical(undefined)).toBe(canonical(null));
  });

  it('finds a conflict only where today differs from the baseline', () => {
    const before = animal();
    const baseline = baselineOf(before, ['summary', 'sizeCm', 'photos']);
    expect(conflictKeys(baseline, animal({ summary: { de: 'Anders.' } }))).toEqual(['summary']);
    expect(conflictKeys(baseline, animal({ photos: [{ assetId: 'M1', sortOrder: 1, isPrimary: true, crop: null, sourceUserId: null, sourceRef: null }] }))).toEqual(['photos']);
    expect(conflictKeys(baseline, before)).toEqual([]);
  });

  it('accepts each kind and refuses what does not fit', () => {
    expect(proposalSubmitSchema.safeParse({ kind: 'create', sourceKey: 'k', externalRef: 'B-1', values: { name: 'Lotte', sex: 'female', birthText: {}, sizeText: {}, summary: {}, body: {} } }).success).toBe(true);
    expect(proposalSubmitSchema.safeParse({ kind: 'create', sourceKey: 'k', values: { name: 'Lotte' } }).success).toBe(false); // externalRef fehlt, Pflichtfelder fehlen
    expect(proposalSubmitSchema.safeParse({ kind: 'update', sourceKey: 'k', animalId: 'A1', values: { slug: 'x' } }).success).toBe(false); // strict
    expect(proposalSubmitSchema.safeParse({ kind: 'notice', sourceKey: 'k', animalId: 'A1', reason: 'nicht mehr gelistet', noticeKind: 'delisted' }).success).toBe(true);
    expect(proposalSubmitSchema.safeParse({ kind: 'notice', sourceKey: 'k', animalId: 'A1', reason: 'x', noticeKind: 'verstorben' }).success).toBe(false);
    expect(proposalSubmitSchema.safeParse({ kind: 'update', sourceKey: 'k', animalId: 'A1', values: {}, hints: [{ quote: 'ohne Titel und Feld' }] }).success).toBe(false);
    expect(proposalSubmitSchema.safeParse({ kind: 'update', sourceKey: 'k', animalId: 'A1', photos: [{ imageId: 'I', mediaId: 'M' }] }).success).toBe(false);
  });

  it('pre-selects new and named photos, drops the source’s own unnamed photo, keeps a Kompass photo (A12)', () => {
    const current = [
      { assetId: 'M-SRC', sortOrder: 1, isPrimary: true, crop: null, sourceUserId: 'S', sourceRef: 'hb-1' },
      { assetId: 'M-OWN', sortOrder: 2, isPrimary: false, crop: null, sourceUserId: null, sourceRef: null },
      { assetId: 'M-KEEP', sortOrder: 3, isPrimary: false, crop: null, sourceUserId: 'S', sourceRef: 'hb-2' },
    ];
    const rows = photoRows('S', [img({ id: 'I1', position: 0, isPrimary: true, sourceRef: 'hb-9' }), img({ id: 'I2', filename: null, mediaId: 'M-KEEP', position: 1 })], current);
    expect(rows.map((r) => [r.key, r.change, r.origin, r.defaultSelected])).toEqual([
      ['image:I1', 'new', 'source', true],
      ['media:M-KEEP', 'kept', 'source', true],
      ['media:M-OWN', 'kept', 'kompass', true],
      ['media:M-SRC', 'dropped', 'source', false],
    ]);
    const chosen = defaultPhotoChoice(rows);
    expect(chosen).toEqual([{ imageId: 'I1', isPrimary: true, crop: null }, { mediaId: 'M-KEEP', isPrimary: false, crop: null }, { mediaId: 'M-OWN', isPrimary: false }]);
    expect(photoChoiceDiffers(rows, chosen)).toBe(false);
    expect(photoChoiceDiffers(rows, chosen.filter((c) => c.mediaId !== 'M-OWN'))).toBe(false); // Kompass-Foto abwählen ist keine Abweichung vom Vorschlag
    expect(photoChoiceDiffers(rows, chosen.filter((c) => c.imageId !== 'I1'))).toBe(true);
    expect(photoChoiceDiffers(rows, [...chosen, { mediaId: 'M-SRC', isPrimary: false }])).toBe(true);
  });
});
