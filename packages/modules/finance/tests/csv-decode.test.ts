import { describe, expect, it } from 'vitest';
import { decodeCsv } from '../src/import/csv';

describe('decodeCsv', () => {
  it('strips a UTF-8 BOM and normalizes line endings', () => {
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62]), 'utf-8')).toBe('a\nb');
  });
  it('reads windows-1252 umlauts and the euro sign', () => {
    expect(decodeCsv(new Uint8Array([0xe4, 0xf6, 0xfc, 0xdf, 0x80]), 'windows-1252')).toBe('äöüß€');
  });
  it('reads iso-8859-1 umlauts', () => {
    expect(decodeCsv(new Uint8Array([0xc4, 0xd6, 0xdc]), 'iso-8859-1')).toBe('ÄÖÜ');
  });
  it('turns a lone carriage return into a line break', () => {
    expect(decodeCsv(new TextEncoder().encode('a\rb'), 'utf-8')).toBe('a\nb');
  });
});
