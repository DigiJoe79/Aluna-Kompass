import { describe, expect, it } from 'vitest';
import { parseAmount } from '@/lib/finance/amount';

describe('parseAmount', () => {
  it.each([
    ['12,5', 1250],
    ['1.234,56', 123456],
    ['12', 1200],
    ['−15,00', -1500],
    ['-15', -1500],
    ['0', 0],
    ['0,00', 0],
  ])('parses %s to %i cents', (input, expected) => {
    expect(parseAmount(input as string)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '12.50', '1,234', '12,345', '1.23,45'])('refuses %s — the dot is never a decimal point', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

// formatAmount und formatEuro reicht die App nur aus `@kompass/module-finance/format` durch; geprüft im Modul
// (packages/modules/finance/tests/format-amount.test.ts).
describe('Feldfehler am Betrag (Runde 3, 087)', () => {
  it('enden mit Punkt wie „Pflichtfeld.“', async () => {
    const messages = (await import('../messages/de.json')).default as { finance: { amount: Record<string, unknown> }; errors: { fields: { required: string } } };
    expect(messages.errors.fields.required.endsWith('.')).toBe(true);
    expect(messages.finance.amount.format).toBe('Bitte einen Betrag wie 12,50 eingeben.');
    expect(String(messages.finance.amount.exceeds).endsWith('.')).toBe(true);
  });
});
