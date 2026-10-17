import { describe, expect, it } from 'vitest';
import { defaultArrangement, deriveArrangement, legacyArrangement, shortestColumn, spreadByOrder, tileLength } from '../src/dashboard/arrangement';

/**
 * Die Regeln der Anordnung (Briefing Startseite § 1 und § 5, Plan 0.2.12 Teil L).
 * Eine Kachel ist hier nur Name und Länge: `L…` lang (Liste, Fällig, Arbeit: 3), `z…` kurz (Zahl, Status: 1).
 */
const len = (name: string) => (name.startsWith('L') ? 3 : 1);

describe('tileLength', () => {
  it('schätzt Liste lang und Zahl wie Status kurz', () => {
    expect(tileLength('list')).toBe(3);
    expect(tileLength('count')).toBe(1);
    expect(tileLength('status')).toBe(1);
  });
});

describe('spreadByOrder: aus der Reihenfolge, abwechselnd und nach Länge ausgeglichen', () => {
  it('legt jede Kachel in die bis dahin kürzeste Spalte, bei Gleichstand in die linke', () => {
    expect(spreadByOrder(['z1', 'z2', 'z3', 'z4', 'z5'], len, 3)).toEqual([['z1', 'z4'], ['z2', 'z5'], ['z3']]);
  });

  it('gleicht eine lange Kachel mit mehreren kurzen aus', () => {
    expect(spreadByOrder(['L1', 'z1', 'z2', 'z3', 'z4', 'L2'], len, 3)).toEqual([['L1'], ['z1', 'z3', 'L2'], ['z2', 'z4']]);
  });

  it('liefert immer so viele Spalten wie verlangt, auch leer', () => {
    expect(spreadByOrder([], len, 2)).toEqual([[], []]);
  });
});

describe('deriveArrangement: der erste Wechsel (Briefing § 5)', () => {
  it('von 3 auf 2:1: erst Spalte 1, dann Spalte 2 in die breite Spalte, Spalte 3 wird die schmale', () => {
    expect(deriveArrangement([['L1', 'z1'], ['L2'], ['z2', 'z3']], 'thirds', len)).toEqual([['L1', 'z1', 'L2'], ['z2', 'z3']]);
  });

  it('von 2:1 auf 3: die breite Spalte zusammenhängend auf 1 und 2, beide etwa gleich lang; die schmale wird 3', () => {
    expect(deriveArrangement([['L1', 'z1', 'z2', 'L2'], ['z3']], 'wide-narrow', len)).toEqual([['L1', 'z1'], ['z2', 'L2'], ['z3']]);
  });

  it('gibt bei Gleichstand der ersten Spalte den Vorzug, damit sie nie leer bleibt', () => {
    expect(deriveArrangement([['L1'], []], 'wide-narrow', len)).toEqual([['L1'], [], []]);
  });

  it('kommt von 2:1 über 3 wieder bei derselben 2:1-Anordnung an', () => {
    const wide = [['L1', 'z1', 'L2', 'z2', 'z3'], ['z4', 'z5']];
    expect(deriveArrangement(deriveArrangement(wide, 'wide-narrow', len), 'thirds', len)).toEqual(wide);
  });
});

describe('defaultArrangement: die Vorgabe des Kerns', () => {
  it('2:1: Listen und Arbeit in die breite Spalte, Zahl und Warnung in die schmale, je in Manifest-Reihenfolge', () => {
    expect(defaultArrangement(['z1', 'L1', 'z2', 'L2'], 'wide-narrow', len)).toEqual([['L1', 'L2'], ['z1', 'z2']]);
  });

  it('drei gleiche: Listen in Spalte 1, Zahl und Warnung ausgeglichen auf 2 und 3', () => {
    expect(defaultArrangement(['z1', 'L1', 'z2', 'L2', 'z3'], 'thirds', len)).toEqual([['L1', 'L2'], ['z1', 'z3'], ['z2']]);
  });

  it('verteilt nach Reihenfolge über alle Spalten, wenn es nur Listen oder nur Zahlen gibt — keine leere erste Spalte', () => {
    expect(defaultArrangement(['z1', 'z2', 'z3'], 'thirds', len)).toEqual([['z1'], ['z2'], ['z3']]);
    expect(defaultArrangement(['L1', 'L2'], 'wide-narrow', len)).toEqual([['L1'], ['L2']]);
  });
});

describe('legacyArrangement: eine alte flache Liste', () => {
  it('drei gleiche: nach Reihenfolge ausgeglichen verteilt', () => {
    expect(legacyArrangement(['L1', 'z1', 'z2', 'z3'], 'thirds', len)).toEqual([['L1'], ['z1', 'z3'], ['z2']]);
  });

  it('2:1: erst auf drei verteilt, dann nach der Ableitungsregel — nichts geht verloren', () => {
    expect(legacyArrangement(['L1', 'z1', 'z2', 'z3'], 'wide-narrow', len)).toEqual([['L1', 'z1', 'z3'], ['z2']]);
  });
});

describe('shortestColumn: wohin eine eingeschaltete Kachel kommt', () => {
  it('nimmt die Spalte mit der kleinsten geschätzten Länge, bei Gleichstand die linke', () => {
    expect(shortestColumn([['L1'], ['z1', 'z2'], ['z3', 'z4']], len)).toBe(1);
    expect(shortestColumn([['z1'], ['z2'], []], len)).toBe(2);
    expect(shortestColumn([[], []], len)).toBe(0);
  });
});
