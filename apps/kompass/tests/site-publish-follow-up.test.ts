import { describe, expect, it } from 'vitest';
import { publishFollowUp } from '@/app/(shell)/site/publish/publish-follow-up';

describe('publishFollowUp', () => {
  it('offers a new preview when the shown one is outdated, whether the start or the run said so', () => {
    expect(publishFollowUp('previewOutdated')).toBe('rebuildPreview');
  });
  it('offers nothing for any other answer', () => {
    expect(publishFollowUp('blockedTermsPresent')).toBeNull();
    expect(publishFollowUp(undefined)).toBeNull();
  });
});
