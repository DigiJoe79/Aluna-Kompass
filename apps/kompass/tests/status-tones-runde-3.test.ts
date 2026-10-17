import { describe, expect, it } from 'vitest';
import { isNormalInList, statusTone } from '@/components/status-badge';

/** Tontabelle nach Runde 3 (Kleinpunkte 3 und 6, 043, 120; Joe 11.7). */
describe('Tontabelle Runde 3', () => {
  it('„Abgelehnt“ ist überall `error` (Kleinpunkt 3)', () => {
    expect(statusTone('claim', 'rejected')).toBe('error');
    expect(statusTone('decision', 'rejected')).toBe('error');
  });

  it('„Reserviert“ ist `info`, „Sucht ein Zuhause“ steht in Listen ohne Marke (Kleinpunkt 6, 043)', () => {
    expect(statusTone('animal', 'reserved')).toBe('info');
    expect(isNormalInList('animal', 'lookingForHome')).toBe(true);
    expect(isNormalInList('animal', 'reserved')).toBe(false);
  });

  it('„im Minus“ ist `error`, „erfüllt, Rest“ bleibt Arbeit in Ocker (120)', () => {
    expect(statusTone('purposeBalance', 'negative')).toBe('error');
    expect(statusTone('purposeBalance', 'fulfilledWithRest')).toBe('warning');
  });

  it('ein gültiger Bescheid trägt in der Liste wieder seine Marke `success` (Joe 11.7)', () => {
    expect(isNormalInList('notice', 'valid')).toBe(false);
    expect(statusTone('notice', 'valid')).toBe('success');
  });

  it('eine ausgezahlte Auslage ist der Endzustand und steht in der Liste ohne Marke (100)', () => {
    expect(isNormalInList('claim', 'paid')).toBe(true);
    expect(isNormalInList('claim', 'approved')).toBe(false);
  });

  it('im Protokoll ist „Oberfläche“ der Normalfall ohne Marke, Agent und System tragen eine (183)', () => {
    expect(isNormalInList('auditChannel', 'ui')).toBe(true);
    expect(isNormalInList('auditChannel', 'mcp')).toBe(false);
    expect(statusTone('auditChannel', 'mcp')).toBe('agent');
  });
});
