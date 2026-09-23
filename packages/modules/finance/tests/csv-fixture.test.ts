import { describe, expect, it } from 'vitest';
import { completeFormat, guessCsvFormat, readCsv, type CsvFormat, type CsvGuess } from '../src/import/csv';
import { buildPaymentServiceCsv, buildSecondBankCsv } from '../src/import/csv-fixture';

const NONE: CsvFormat['columns'] = { bookingDate: '', valueDate: null, amount: null, debit: null, credit: null, debitCreditIndicator: null, counterpartyName: null, counterpartyIban: null, purpose: null, reference: null, fee: null, balance: null, currency: null, pending: null };
const fromGuess = (g: CsvGuess) => completeFormat(g, { columns: { ...NONE, ...g.columns } as CsvFormat['columns'], invertSign: false, dateFormat: g.dateFormat!, decimalSeparator: g.decimalSeparator! });

describe('CSV fixtures for seed and E2E', () => {
  it('payment-service export: the guess maps everything but the sign, and the file reads with fees, a pending row and balances', () => {
    const bytes = buildPaymentServiceCsv();
    const g = guessCsvFormat(bytes);
    expect(g).toMatchObject({ encoding: 'utf-8', delimiter: ',', headerRow: 0, dateFormat: 'DD.MM.YYYY', decimalSeparator: ',' });
    expect(g.columns).toMatchObject({ bookingDate: 'Datum', counterpartyName: 'Name', amount: 'Brutto', fee: 'Gebühr', reference: 'Transaktionscode', balance: 'Guthaben', currency: 'Währung', purpose: 'Betreff', pending: { column: 'Status', values: ['Ausstehend'] } });
    expect(Object.values(g.columns)).not.toContain('Netto');
    const r = readCsv(bytes, fromGuess(g));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.statement.from, r.statement.to, r.statement.openingCents, r.statement.closingCents]).toEqual(['2026-03-05', '2026-03-10', 10000, 785]);
    expect(r.statement.lines.filter((l) => l.pending)).toHaveLength(2);
    expect(r.statement.lines.filter((l) => l.bankReference?.endsWith(':fee') && !l.pending)).toHaveLength(2);
  });

  it('second bank: windows-1252, preamble, split columns — the guess needs no hand', () => {
    const bytes = buildSecondBankCsv();
    const g = guessCsvFormat(bytes);
    expect(g).toMatchObject({ encoding: 'windows-1252', delimiter: ';', headerRow: 4, dateFormat: 'DD.MM.YYYY', decimalSeparator: ',' });
    expect(g.columns).toMatchObject({ bookingDate: 'Buchungstag', valueDate: 'Wertstellung', counterpartyName: 'Auftraggeber/Empfänger', purpose: 'Verwendungszweck', debit: 'Soll', credit: 'Haben' });
    const r = readCsv(bytes, fromGuess(g));
    expect(r.ok && r.statement.lines.map((l) => [l.bookingDate, l.amountCents, l.counterpartyName])).toEqual([
      ['2026-03-03', 6000, 'Erika Beispiel'],
      ['2026-03-04', -4590, 'Druckerei Müller & Söhne'],
    ]);
  });
});
