import { describe, expect, it } from 'vitest';
import { csvDocument, csvField } from '../src/format/csv';

describe('csvField', () => {
  it('sperrt Formeln und setzt Anführungszeichen', () => {
    expect(csvField('=1+1')).toBe(`"'=1+1"`);
    expect(csvField('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvField('-5')).toBe(`"'-5"`);
  });
  it('fasst Semikolon, Anführungszeichen und Zeilenumbruch in ein Feld', () => {
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('sagt "hallo"')).toBe('"sagt ""hallo"""');
    expect(csvField('Zeile\r\nzwei')).toBe('"Zeile\r\nzwei"');
  });
  it('lässt einfache Werte unverändert und leert null', () => {
    expect(csvField('Futter')).toBe('Futter');
    expect(csvField(null)).toBe('');
    expect(csvField('')).toBe('');
  });
});

describe('csvDocument', () => {
  it('schreibt BOM, Kopf, Semikolon und CRLF bis zur letzten Zeile', () => {
    expect(csvDocument(['A', 'B'], [['1', null]])).toBe('﻿A;B\r\n1;\r\n');
  });
  it('nimmt einen Iterator', () => {
    function* rows() { yield ['x;y']; }
    expect(csvDocument(['A'], rows())).toBe('﻿A\r\n"x;y"\r\n');
  });
});
