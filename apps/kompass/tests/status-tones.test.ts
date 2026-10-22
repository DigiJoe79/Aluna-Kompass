import { describe, expect, it } from 'vitest';
import { isNormalInList, STATUS_TONES, type StatusKind } from '@/components/status-badge';

/**
 * Regeln der Tontabelle (Designer Stufe 2 Nr. 6, Runde 3 Kleinpunkt 3, MUSTER § F) — nicht die Tabelle selbst: Welcher
 * Zustand welchen Ton trägt, steht in `STATUS_TONES` und wird dort entschieden. Dass keine zweite Tabelle entsteht,
 * prüft `patterns/status-tones.test.ts`.
 */
const entries = Object.entries(STATUS_TONES).flatMap(([kind, tones]) => Object.entries(tones).map(([status, tone]) => ({ kind: kind as StatusKind, status, tone: tone as string })));

describe('STATUS_TONES', () => {
  it('trägt nie accent — die Markenfarbe ist kein Zustand (6b)', () => {
    expect(entries.filter((e) => e.tone === 'accent').map((e) => `${e.kind}.${e.status}`)).toEqual([]);
  });

  it('„abgelehnt“ ist überall error (Kleinpunkt 3)', () => {
    expect(entries.filter((e) => e.status === 'rejected' && e.tone !== 'error').map((e) => e.kind)).toEqual([]);
  });

  it('ein Normalzustand ohne Marke ist nie Fehler oder offene Arbeit (6a)', () => {
    const loud = entries.filter((e) => isNormalInList(e.kind, e.status as never) && (e.tone === 'error' || e.tone === 'warning'));
    expect(loud.map((e) => `${e.kind}.${e.status}`)).toEqual([]);
  });
});
