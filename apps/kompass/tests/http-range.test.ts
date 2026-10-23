import { describe, expect, it } from 'vitest';
import { parseRange } from '@/lib/http-range';

describe('parseRange', () => {
  it('liest einen Bereich, sonst die ganze Datei', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=2000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-9', 1000)).toBeNull(); // mehrere Bereiche: ganze Datei (Planer)
    expect(parseRange('items=0-1', 1000)).toBeNull();
    expect(parseRange('bytes=9-1', 1000)).toBeNull();
    expect(parseRange('bytes=abc', 1000)).toBeNull();
  });
});
