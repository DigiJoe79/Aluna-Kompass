import { describe, expect, it } from 'vitest';
import { countParts, withoutZeros } from '@/lib/count-parts';

/**
 * Nullen in Zählern und Folgen fallen weg (Designer Runde 3: 078, 079, 115, 137): „3 neu · 1 bereits vorhanden“
 * statt „3 neu · 1 bereits vorhanden · 0 zurückgehalten“.
 */
describe('countParts', () => {
  it('lässt Teile mit null weg und verbindet den Rest mit „ · “', () => {
    expect(countParts([[3, '3 neu'], [1, '1 bereits vorhanden'], [0, '0 zurückgehalten']])).toBe('3\u00a0neu · 1\u00a0bereits\u00a0vorhanden');
  });

  it('sind alle null, bleibt der erste Teil stehen — die Zeile sagt dann „0 neu“ statt nichts', () => {
    expect(countParts([[0, '0 neu'], [0, '0 bereits vorhanden']])).toBe('0\u00a0neu');
  });

  // Runde 4 Nachtrag (214, 217): „1 neu · 1 zurückgehalten“ bricht nur am „·“, nie zwischen Zahl und Wort.
  it('hält jeden Teil mit geschütztem Leerzeichen zusammen; umbrechen kann nur der Trenner', () => {
    const text = countParts([[1, '1 neu'], [1, '1 zurückgehalten']]);
    expect(text).toBe('1\u00a0neu · 1\u00a0zurückgehalten');
    expect(text.split(' ')).toEqual(['1\u00a0neu', '·', '1\u00a0zurückgehalten']);
  });

  it('withoutZeros gibt die Teile selbst zurück (auch React-Knoten)', () => {
    expect(withoutZeros([[0, 'a'], [2, 'b'], [5, 'c']])).toEqual(['b', 'c']);
    expect(withoutZeros([])).toEqual([]);
  });
});
