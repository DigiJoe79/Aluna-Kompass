import type { DashboardTileView } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { calmLast, figureBlocks, mergeThirds, tileArt, viewColumns } from '@/app/(shell)/dashboard/columns';

/**
 * Die reine Logik der Startseite in Spalten (Briefing Startseite § 1, § 2, § 4; Vorgaben Teil M): welche Art ein
 * Widget hat, wie die Kacheln auf Spalten stehen, wie drei Spalten unter 1440 px zu zweien werden und welche
 * Zahl-Widgets ein gemeinsames Raster bilden.
 */
const view = (partial: Partial<DashboardTileView>): DashboardTileView =>
  ({ module: 'm', key: 'k', kind: 'count', variant: null, warningAction: false, column: 0, options: {}, content: null, error: false, ...partial }) as DashboardTileView;
const count = (n: number) => view({ content: { kind: 'count', count: n, href: '/x' } });
const status = (tone: 'neutral' | 'info' | 'warning') => view({ kind: 'status', content: { kind: 'status', tone, messageKey: 'x', href: '/x' } });
const list = (total: number, lines = total, variant: 'due' | 'work' | null = null) =>
  view({ kind: 'list', variant, content: { kind: 'list', total, href: '/x', lines: Array.from({ length: lines }, (_, i) => ({ title: `Zeile ${i}` })) } });

describe('tileArt: fünf Arten und der Ruhezustand', () => {
  it('Zahl, Liste, Fällig, Arbeit und Warnung', () => {
    expect(tileArt(count(3))).toBe('count');
    expect(tileArt(list(4))).toBe('list');
    expect(tileArt(list(2, 2, 'due'))).toBe('due');
    expect(tileArt(list(13, 13, 'work'))).toBe('work');
    expect(tileArt(status('warning'))).toBe('warning');
  });

  it('ein Status `info` ist Arbeit wie eine Zahl, nur mit Satz (Vorgaben Teil M, 3)', () => {
    expect(tileArt(status('info'))).toBe('info');
  });

  it('Ruhe: leere Zahl oder Liste, Status `neutral` — auch bei Fällig und Arbeit', () => {
    expect(tileArt(count(0))).toBe('calm');
    expect(tileArt(list(0))).toBe('calm');
    expect(tileArt(list(0, 0, 'due'))).toBe('calm');
    expect(tileArt(list(0, 0, 'work'))).toBe('calm');
    expect(tileArt(status('neutral'))).toBe('calm');
  });

  it('eine Liste ohne Zeilen, aber mit Gesamtzahl, zeigt die Zahl', () => {
    expect(tileArt(list(5, 0))).toBe('count');
  });

  it('eine Listen-Kachel, die ohne Leserecht einen Status liefert, folgt dem Ton', () => {
    expect(tileArt(view({ kind: 'list', content: { kind: 'status', tone: 'warning', messageKey: 'x', href: null } }))).toBe('warning');
  });

  it('ein Ladefehler ist eine eigene Art', () => {
    expect(tileArt(view({ error: true }))).toBe('error');
  });
});

describe('viewColumns: die Kacheln Spalte für Spalte', () => {
  it('legt jede Kachel in ihre Spalte, in Reihenfolge, auch leere Spalten', () => {
    const items = [{ id: 'a', column: 0 }, { id: 'b', column: 2 }, { id: 'c', column: 0 }];
    expect(viewColumns(items, 3).map((c) => c.map((i) => i.id))).toEqual([['a', 'c'], [], ['b']]);
  });
});

describe('mergeThirds: drei gleiche Spalten unter 1440 px als zwei', () => {
  it('verteilt Spalte 3 nach Reihenfolge abwechselnd ans Ende von 1 und 2', () => {
    expect(mergeThirds([['a'], ['b'], ['c1', 'c2', 'c3']])).toEqual([['a', 'c1', 'c3'], ['b', 'c2']]);
  });

  it('lässt zwei Spalten, wie sie sind', () => {
    expect(mergeThirds([['a'], ['b']])).toEqual([['a'], ['b']]);
  });
});

describe('figureBlocks: aufeinanderfolgende Zahl-Widgets in einem Raster', () => {
  it('fasst Zahl und Info zusammen, alles andere steht für sich', () => {
    const arts = ['warning', 'count', 'info', 'count', 'list', 'count', 'calm'] as const;
    const blocks = figureBlocks([...arts.keys()], (i) => arts[i]!);
    expect(blocks).toEqual([
      { kind: 'single', item: 0 },
      { kind: 'figures', items: [1, 2, 3] },
      { kind: 'single', item: 4 },
      { kind: 'figures', items: [5] },
      { kind: 'single', item: 6 },
    ]);
  });
});

describe('calmLast: Ruhe-Zeilen am Ende der Spalte (Designer 2026-10-17, Frage 1)', () => {
  it('stellt ruhige Widgets hinter alle anderen, beide Gruppen in der gespeicherten Reihenfolge', () => {
    const arts = ['calm', 'count', 'calm', 'warning', 'count', 'list', 'calm'] as const;
    expect(calmLast([...arts.keys()], (i) => arts[i]!)).toEqual([1, 3, 4, 5, 0, 2, 6]);
  });

  it('ein Ladefehler bleibt an seinem Platz — er ist kein Ruhezustand', () => {
    const arts = ['error', 'calm', 'count'] as const;
    expect(calmLast([...arts.keys()], (i) => arts[i]!)).toEqual([0, 2, 1]);
  });

  it('so rücken Zahl-Widgets, die eine Ruhe-Zeile getrennt hat, in ein Raster', () => {
    const arts = ['count', 'calm', 'count'] as const;
    const art = (i: number) => arts[i]!;
    expect(figureBlocks(calmLast([0, 1, 2], art), art)).toEqual([
      { kind: 'figures', items: [0, 2] },
      { kind: 'single', item: 1 },
    ]);
  });
});
