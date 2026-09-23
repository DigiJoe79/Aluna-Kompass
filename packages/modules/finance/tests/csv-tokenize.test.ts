import { describe, expect, it } from 'vitest';
import { tokenizeCsv } from '../src/import/csv';

describe('tokenizeCsv', () => {
  it('splits by the delimiter and keeps empty fields', () => {
    expect(tokenizeCsv('a;b;;d\n1;2;3;4', ';')).toEqual([['a', 'b', '', 'd'], ['1', '2', '3', '4']]);
  });
  it('honours quotes, doubled quotes, delimiters and line breaks inside quotes', () => {
    expect(tokenizeCsv('"x;y";"sagte ""hallo""";"zwei\nZeilen"', ';')).toEqual([['x;y', 'sagte "hallo"', 'zwei\nZeilen']]);
  });
  it('drops trailing empty lines but keeps inner ones as empty rows', () => {
    expect(tokenizeCsv('a\n\nb\n\n', ',')).toEqual([['a'], [''], ['b']]);
  });
  it('handles tab as delimiter', () => {
    expect(tokenizeCsv('a\tb', '\t')).toEqual([['a', 'b']]);
  });
  it('keeps a trailing empty field', () => {
    expect(tokenizeCsv('a;b;', ';')).toEqual([['a', 'b', '']]);
  });
});
