import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/** Zahlung an Partner, Runde 3 (118): Pflicht und zusätzliche Nachweise getrennt gezählt, keine Nullen. */
describe('Nachweise einer Zahlung an Partner', () => {
  const t = createTranslator({ locale: 'de', messages, namespace: 'finance.partners.payment.evidence' as never }) as unknown as (key: string, values: Record<string, string | number>) => string;

  it('vollständig: „1 Pflicht-Nachweis belegt, 1 zusätzlich“', () => {
    expect(t('count', { done: 1, total: 1, complete: 'yes', extra: 1 })).toBe('1 Pflicht-Nachweis belegt, 1 zusätzlich');
    expect(t('count', { done: 2, total: 2, complete: 'yes', extra: 0 })).toBe('2 Pflicht-Nachweise belegt');
  });

  it('unvollständig: „1 von 2 Pflicht-Nachweisen belegt“', () => {
    expect(t('count', { done: 1, total: 2, complete: 'no', extra: 0 })).toBe('1 von 2 Pflicht-Nachweisen belegt');
    expect(t('count', { done: 0, total: 1, complete: 'no', extra: 2 })).toBe('0 von 1 Pflicht-Nachweisen belegt, 2 zusätzlich');
  });
});
