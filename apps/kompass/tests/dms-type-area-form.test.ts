import { describe, expect, it } from 'vitest';
import { readProtectionArea } from '@/app/(shell)/admin/dms/protection-area';

describe('readProtectionArea', () => {
  it('leaves the area alone when the form has no such field, and clears it on an empty value', () => {
    const without = new FormData();
    without.set('label', 'Geheimsache');
    expect(readProtectionArea(without)).toBeUndefined();
    const cleared = new FormData();
    cleared.set('label', 'Geheimsache');
    cleared.set('protectionArea', '');
    expect(readProtectionArea(cleared)).toBeNull();
    const set = new FormData();
    set.set('protectionArea', ' finance ');
    expect(readProtectionArea(set)).toBe('finance');
  });
});
