import { describe, expect, it } from 'vitest';
import { epcQrPayload } from '../src/ledger/epc-qr';

/**
 * N5: die Nutzlast des EPC-QR (GiroCode) nach EPC069-12, Version 002,
 * Zeichensatz 1 (UTF-8), SCT, ohne BIC. Reine Funktion — kein Dienst, kein
 * MCP-Werkzeug (AGENTS.md, Plan N5 Task 1).
 */
describe('epcQrPayload', () => {
  it('builds the twelve lines of an EPC payload', () => {
    const payload = epcQrPayload({ recipient: 'Hanna Vogt', iban: 'DE19 9999 9999 0000 1234 56', amountCents: 1250, reference: 'KE-2026-003' });
    expect(payload).toBe(['BCD', '002', '1', 'SCT', '', 'Hanna Vogt', 'DE19999999990000123456', 'EUR12.50', '', '', 'KE-2026-003', ''].join('\n'));
  });

  it('formats amounts with two decimals and a dot', () => {
    const line = (amountCents: number) => epcQrPayload({ recipient: 'Hanna Vogt', iban: 'DE19 9999 9999 0000 1234 56', amountCents, reference: 'KE-2026-003' })!.split('\n')[7];
    expect(line(5)).toBe('EUR0.05');
    expect(line(100000)).toBe('EUR1000.00');
    expect(line(99999999999)).toBe('EUR999999999.99');
  });

  it('returns null for a missing or invalid iban, a zero or negative amount, or an amount above the EPC limit', () => {
    const base = { recipient: 'Hanna Vogt', iban: 'DE19 9999 9999 0000 1234 56', amountCents: 1250, reference: 'KE-2026-003' };
    expect(epcQrPayload({ ...base, iban: '' })).toBeNull();
    expect(epcQrPayload({ ...base, iban: 'DE00 0000 0000 0000 0000 00' })).toBeNull(); // falsche Prüfziffer
    expect(epcQrPayload({ ...base, amountCents: 0 })).toBeNull();
    expect(epcQrPayload({ ...base, amountCents: -100 })).toBeNull();
    expect(epcQrPayload({ ...base, amountCents: 100000000000 })).toBeNull(); // > 999.999.999,99 €
    expect(epcQrPayload({ ...base, amountCents: 99999999999 })).not.toBeNull(); // genau die Grenze
  });

  it('keeps utf-8 and cuts recipient to 70 and reference to 140 characters', () => {
    const longName = `Müller-Lüdenscheidt ${'ä'.repeat(60)}`; // 80 Zeichen mit Umlauten
    expect(longName.length).toBe(80);
    const longReference = `Zweck einer sehr langen Spende fuer die laufende Vereinsarbeit ${'x'.repeat(87)}`; // 150 Zeichen, ohne Umlaute — die Bytegrenze prüft der nächste Test
    expect(longReference.length).toBe(150);
    const payload = epcQrPayload({ recipient: longName, iban: 'DE19 9999 9999 0000 1234 56', amountCents: 1250, reference: longReference })!;
    const [, , , , , recipientLine, , , , , referenceLine] = payload.split('\n');
    expect(recipientLine).toHaveLength(70);
    expect(recipientLine).toBe(longName.slice(0, 70));
    expect(referenceLine).toHaveLength(140);
    expect(referenceLine).toBe(longReference.slice(0, 140));
  });

  it('stays within 331 bytes', () => {
    const recipient = `Müller-Lüdenscheidt${'ö'.repeat(50)}`; // 70 Zeichen, viele Zweibyte-Zeichen
    const reference = `Weihnachtsspende für Öffentlichkeitsarbeit${'ü'.repeat(97)}`; // 140 Zeichen, viele Zweibyte-Zeichen
    const payload = epcQrPayload({ recipient, iban: 'DE19 9999 9999 0000 1234 56', amountCents: 1250, reference })!;
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(331);
    // Bei so vielen Zweibyte-Zeichen reicht das Kürzen auf Zeichen nicht — der Freitext wurde weiter gekürzt.
    expect(payload.split('\n')[10]!.length).toBeLessThan(140);
  });

  it('trims and collapses whitespace, strips line breaks', () => {
    const payload = epcQrPayload({ recipient: '  Hanna   Vogt  \n', iban: 'DE19 9999 9999 0000 1234 56', amountCents: 1250, reference: '\tKE-2026-003\r\n  weiterer Text  ' })!;
    const [, , , , , recipientLine, , , , , referenceLine] = payload.split('\n');
    expect(recipientLine).toBe('Hanna Vogt');
    expect(referenceLine).toBe('KE-2026-003 weiterer Text');
  });
});
