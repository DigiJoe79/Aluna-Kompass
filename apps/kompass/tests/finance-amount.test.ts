import { describe, expect, it } from 'vitest';
import { parseAmount, readAmount, readAmounts } from '@/lib/finance/amount';

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

describe('readAmount — leer, unlesbar und Pflicht auseinanderhalten (Code-Review 0.4.0, App-B6/B7)', () => {
  it('liest einen Betrag in Cent, Pflicht oder nicht', () => {
    expect(readAmount('12,50', { required: true })).toEqual({ ok: true, cents: 1250 });
    expect(readAmount(' 0 ', { required: false })).toEqual({ ok: true, cents: 0 });
  });
  it('leer und optional heißt „kein Betrag“', () => {
    expect(readAmount('', { required: false })).toEqual({ ok: true, cents: null });
    expect(readAmount('   ', { required: false })).toEqual({ ok: true, cents: null });
  });
  it('leer und Pflicht fehlt — kein Formatfehler', () => {
    expect(readAmount('', { required: true })).toEqual({ ok: false, error: 'missing' });
    expect(readAmount('  ', { required: true })).toEqual({ ok: false, error: 'missing' });
  });
  it.each(['abc', '12.50', '1,234'])('unlesbar (%s) ist ein Formatfehler, auch wenn optional', (input) => {
    expect(readAmount(input, { required: false })).toEqual({ ok: false, error: 'format' });
    expect(readAmount(input, { required: true })).toEqual({ ok: false, error: 'format' });
  });
});

describe('readAmounts — mehrere Betragsfelder einer Maske', () => {
  it('liefert alle Werte oder alle Feldfehler', () => {
    expect(readAmounts({ target: { text: '', required: false }, carry: { text: '1.000', required: false } })).toEqual({ ok: true, cents: { target: null, carry: 100000 } });
    expect(readAmounts({ target: { text: '12.50', required: false }, carry: { text: '', required: true }, ok: { text: '1', required: true } })).toEqual({ ok: false, errors: { target: 'format', carry: 'missing' } });
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
