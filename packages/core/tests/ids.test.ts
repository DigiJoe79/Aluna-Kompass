import { describe, expect, it } from 'vitest';
import { ID_PATTERN, newId } from '../src/ids';

describe('ids', () => {
  it('produces 26-char Crockford base32 ULIDs', () => {
    expect(newId()).toMatch(ID_PATTERN);
  });

  it('is unique and lexicographically monotonic within a burst', () => {
    const ids = Array.from({ length: 200 }, () => newId());
    expect(new Set(ids).size).toBe(200);
    expect([...ids].sort()).toEqual(ids);
  });
});
