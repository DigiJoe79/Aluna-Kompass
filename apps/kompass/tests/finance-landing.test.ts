import { describe, expect, it } from 'vitest';
import { financeLandingPath } from '@/lib/finance/landing';

/**
 * Wohin `/finance` führt (Plan D1b Global Constraints): Wer nur die Prüferrolle hat — Finanzrechte genau lesen,
 * Überblick und prüfen —, landet auf der Kassenprüfung (Board 1b „Startseite des Prüfers“); alle anderen im Journal.
 */
describe('financeLandingPath', () => {
  it('nur Prüferrechte in den Finanzen → Kassenprüfung, auch neben Rechten anderer Module', () => {
    expect(financeLandingPath(new Set(['finance.read', 'finance.overview', 'finance.audit']))).toBe('/finance/audit');
    expect(financeLandingPath(new Set(['finance.read', 'finance.overview', 'finance.audit', 'documents.export', 'dms.view', 'contacts.read']))).toBe('/finance/audit');
  });

  it('ein weiteres Finanzrecht oder ein fehlendes Prüferrecht → Journal', () => {
    expect(financeLandingPath(new Set(['finance.read', 'finance.overview', 'finance.audit', 'finance.entriesWrite']))).toBe('/finance/entries');
    expect(financeLandingPath(new Set(['finance.read', 'finance.overview']))).toBe('/finance/entries');
    expect(financeLandingPath(new Set(['finance.read', 'finance.audit']))).toBe('/finance/entries');
    expect(financeLandingPath(new Set())).toBe('/finance/entries');
  });
});
