import { describe, expect, it } from 'vitest';
import { mergePhotos } from '@/app/(shell)/animals/photos-merge';

describe('mergePhotos', () => {
  it('keeps order and primary, appends new, drops unchecked, promotes the first when the primary left', () => {
    const current = [{ assetId: 'A', isPrimary: false }, { assetId: 'B', isPrimary: true }, { assetId: 'C', isPrimary: false }];
    expect(mergePhotos(current, ['C', 'A', 'D'])).toEqual([{ assetId: 'A', isPrimary: false }, { assetId: 'C', isPrimary: false }, { assetId: 'D', isPrimary: false }].map((p, i) => (i === 0 ? { ...p, isPrimary: true } : p)));
    expect(mergePhotos(current, ['B', 'A'])).toEqual([{ assetId: 'A', isPrimary: false }, { assetId: 'B', isPrimary: true }]);
    expect(mergePhotos(current, [])).toEqual([]);
  });
});
