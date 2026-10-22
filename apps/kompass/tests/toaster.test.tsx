// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { toastBottomOffset } from '@/components/ui/sonner';

describe('Toaster', () => {
  it('steht über einer klebenden Leiste: Leistenhöhe + 16 px, sonst die Vorgabe', () => {
    expect(toastBottomOffset(0)).toBeUndefined();
    expect(toastBottomOffset(61)).toBe(77);
  });
});
