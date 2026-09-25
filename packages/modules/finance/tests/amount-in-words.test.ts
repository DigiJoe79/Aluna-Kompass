import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { amountInWords } from '../src/ledger/amount-in-words';

const euro = (e: number) => Math.round(e * 100);

describe('amountInWords', () => {
  it('writes the edge cases of the German number words', () => {
    expect(amountInWords(euro(1))).toBe('ein Euro');
    expect(amountInWords(euro(21))).toBe('einundzwanzig Euro');
    expect(amountInWords(euro(100))).toBe('einhundert Euro');
    expect(amountInWords(euro(101))).toBe('einhunderteins Euro');
    expect(amountInWords(euro(119))).toBe('einhundertneunzehn Euro');
    expect(amountInWords(euro(1000))).toBe('eintausend Euro');
    expect(amountInWords(euro(1001))).toBe('eintausendeins Euro');
    expect(amountInWords(euro(1000000))).toBe('eine Million Euro');
    expect(amountInWords(5)).toBe('fünf Cent');
  });

  it('joins euros and cents with „und“', () => {
    expect(amountInWords(11919)).toBe('einhundertneunzehn Euro und neunzehn Cent');
    expect(amountInWords(101)).toBe('ein Euro und ein Cent');
    expect(amountInWords(euro(30.5))).toBe('dreißig Euro und fünfzig Cent');
  });

  it('covers teens, tens and compounds up to the limit', () => {
    expect(amountInWords(euro(11))).toBe('elf Euro');
    expect(amountInWords(euro(12))).toBe('zwölf Euro');
    expect(amountInWords(euro(16))).toBe('sechzehn Euro');
    expect(amountInWords(euro(17))).toBe('siebzehn Euro');
    expect(amountInWords(euro(77))).toBe('siebenundsiebzig Euro');
    expect(amountInWords(euro(2500))).toBe('zweitausendfünfhundert Euro');
    expect(amountInWords(euro(21031))).toBe('einundzwanzigtausendeinunddreißig Euro');
    expect(amountInWords(euro(2000000))).toBe('zwei Millionen Euro');
    expect(amountInWords(euro(1002003))).toBe('eine Million zweitausenddrei Euro');
    expect(amountInWords(99999999999)).toBe('neunhundertneunundneunzig Millionen neunhundertneunundneunzigtausendneunhundertneunundneunzig Euro und neunundneunzig Cent');
    expect(amountInWords(0)).toBe('null Euro');
  });

  it('refuses negative, fractional and too large amounts', () => {
    expect(() => amountInWords(-1)).toThrow(RangeError);
    expect(() => amountInWords(1.5)).toThrow(RangeError);
    expect(() => amountInWords(100000000000)).toThrow(RangeError);
  });
});

describe('amount in words purity', () => {
  it('imports nothing — no @kompass/*, no relative path', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/ledger/amount-in-words.ts'), 'utf8');
    const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(imports).toEqual([]);
  });
});
