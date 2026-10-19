import { isoDay, type DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { createDocumentEngine, pdfPageCount, QR_QUIET_ZONE, qrRows, TRANSFER_BLOCK_LIB, transferBlock, type TransferBlockData } from '../src';

describe('qrRows', () => {
  it('is a square of 0/1 rows with a quiet zone of four modules', () => {
    const rows = qrRows('https://example.org/tiere/mika/');
    expect(rows.length).toBeGreaterThanOrEqual(21 + 2 * QR_QUIET_ZONE);
    for (const row of rows) expect(row).toMatch(new RegExp(`^[01]{${rows.length}}$`));
    expect(rows.slice(0, QR_QUIET_ZONE).every((r) => !r.includes('1'))).toBe(true);
    expect(rows.slice(-QR_QUIET_ZONE).every((r) => !r.includes('1'))).toBe(true);
  });

  it('starts with the finder pattern after the quiet zone and is deterministic', () => {
    const rows = qrRows('https://example.org/tiere/mika/');
    expect(rows[QR_QUIET_ZONE]!.slice(QR_QUIET_ZONE, QR_QUIET_ZONE + 7)).toBe('1111111');
    expect(qrRows('https://example.org/tiere/mika/')).toEqual(rows);
  });
});

const labels = { title: 'Überweisung', recipient: 'Empfänger', iban: 'IBAN', bic: 'BIC', amount: 'Betrag', reference: 'Verwendungszweck', qr: 'GiroCode' };
const data = (over: Partial<TransferBlockData> = {}): TransferBlockData => ({
  name: 'Musterverein "Nord" e.V.',
  iban: 'DE02999999990532013000',
  bic: 'TESTDEFFXXX',
  amount: '60,00 €',
  reference: 'Beitrag 2026 Mitglied 0006',
  qr: qrRows('BCD\n002\n1\nSCT\n\nMusterverein\nDE02999999990532013000\nEUR60.00\n\n\nBeitrag 2026 Mitglied 0006\n'),
  labels,
  ...over,
});

describe('transferBlock', () => {
  it('passes every value as a Typst string, so nothing in it acts as markup', () => {
    const call = transferBlock(data());
    expect(call.startsWith('#transfer-block((')).toBe(true);
    expect(call).toContain('name: "Musterverein \\"Nord\\" e.V."');
    expect(call).toContain('reference: "Beitrag 2026 Mitglied 0006"');
    expect(call).toContain('amount: "60,00 €"');
    // Die Vierergruppen der IBAN setzt Typst (MUSTER „IBAN“): roh hinein, ohne Leerräume.
    expect(call).toContain('iban: "DE02999999990532013000"');
  });

  it('leaves BIC and code out when there are none', () => {
    const call = transferBlock(data({ bic: null, qr: null }));
    expect(call).toContain('bic: none');
    expect(call).toContain('qr: none');
  });

  it('groups the IBAN in fours in Typst', () => {
    expect(TRANSFER_BLOCK_LIB).toContain('.clusters().chunks(4)');
  });
});

describe('transferBlock with real Typst', () => {
  const engine = createDocumentEngine();
  const ctx: DocumentRenderContext = { number: 'MAH-2026-001', issuedAt: '2026-10-18T12:00:00.000Z', issuedDay: isoDay('2026-10-18'), organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };

  it('renders with and without code and BIC on one page', async () => {
    for (const block of [transferBlock(data()), transferBlock(data({ bic: null, qr: null }))]) {
      const { bytes } = await engine.render({ baseId: 'a4-mit-briefkopf', bodyTypst: `${TRANSFER_BLOCK_LIB}\nEin Satz davor.\n\n${block}\n`, slots: { kind: 'letter', subject: 'Test' }, context: ctx });
      expect(pdfPageCount(bytes)).toBe(1);
    }
  });
});
