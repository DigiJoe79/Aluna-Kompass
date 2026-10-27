import { describe, expect, it } from 'vitest';
import { isNormalInList, STATUS_TONES, statusTone, type StatusKind } from '@/components/status-badge';

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

  it('festgeschrieben ist überall final, und eine Ausgabestufe ist nie Arbeit (N2, Freigabe Joe 2026-10-24)', () => {
    expect(entries.filter((e) => e.status === 'final' && e.tone !== 'final').map((e) => e.kind)).toEqual([]);
    // Jede Stufe, die der Dienst ableitet (`ReportStage`), hat einen Ton; vorläufig verlangt keine Arbeit.
    const stages = (['preliminary', 'review', 'final'] as const).map((stage) => statusTone('reportStage', stage));
    expect(stages.every((tone) => typeof tone === 'string' && tone !== 'warning' && tone !== 'error')).toBe(true);
    expect(isNormalInList('reportStage', 'final')).toBe(false);
  });

  it('Kassenprüfung: Arbeit nur, wo der Prüfer oder die Schatzmeisterin handeln muss (N3, N4, Runde 3, Freigabe Joe 2026-10-24)', () => {
    expect(statusTone('remark', 'open')).toBe('warning');
    expect(statusTone('sample', 'recheck')).toBe('warning');
    // Geklärt steht mit Marke in der Spalte „Zustand“, die Zeile ist nicht gedämpft (Designer Runde 7, 272/273).
    expect(isNormalInList('remark', 'resolved')).toBe(false);
    expect(statusTone('remark', 'resolved')).toBe('neutral');
    // Ein Bericht in Arbeit ist ein Zwischenstand, kein Fehler; abgelegt ist er festgeschrieben.
    expect(['draft', 'readyToSign'].map((s) => statusTone('auditReport', s as 'draft'))).not.toContain('warning');
    expect(statusTone('auditReport', 'filed')).toBe('final');
  });
});
