import { describe, expect, it } from 'vitest';
import { csvFormatSchema, headerSignature, readCsv, tokenizeCsv, type CsvFormat } from '../src/import/csv';

const enc = (s: string) => new TextEncoder().encode(s);
const BANK_HEADER = 'Buchungstag;Valuta;Auftraggeber/Empfänger;IBAN;Verwendungszweck;Betrag;Saldo';

function bankFormat(over: Partial<CsvFormat> = {}): CsvFormat {
  return csvFormatSchema.parse({
    encoding: 'utf-8',
    delimiter: ';',
    headerRow: 0,
    headerSignature: headerSignature(tokenizeCsv(BANK_HEADER, ';')[0]!),
    dateFormat: 'DD.MM.YYYY',
    decimalSeparator: ',',
    columns: {
      bookingDate: 'Buchungstag', valueDate: 'Valuta', amount: 'Betrag', debit: null, credit: null, debitCreditIndicator: null,
      counterpartyName: 'Auftraggeber/Empfänger', counterpartyIban: 'IBAN', purpose: 'Verwendungszweck',
      reference: null, fee: null, balance: 'Saldo', currency: null, pending: null,
    },
    invertSign: false,
    ...over,
  });
}

/** Ein Format mit eigener Kopfzeile und abweichenden Spalten. */
function formatFor(header: string, columns: Partial<CsvFormat['columns']>, over: Partial<CsvFormat> = {}): CsvFormat {
  const base = bankFormat();
  return csvFormatSchema.parse({
    ...base,
    headerSignature: headerSignature(header.split(';')),
    columns: { ...base.columns, valueDate: null, counterpartyIban: null, purpose: null, balance: null, ...columns },
    ...over,
  });
}

const bankFile = (rows: string[]) => enc([BANK_HEADER, ...rows].join('\n'));

describe('readCsv', () => {
  it('reads dates, signed amounts with thousands separators, IBAN and purpose', () => {
    const r = readCsv(bankFile(['02.01.2026;02.01.2026;Erika Beispiel;DE66 9999 9999 1234 5678 90;Spende  Januar;1.234,50;2.234,50', '03.01.2026;03.01.2026;Druckerei Muster;;Flyer;-80,00;2.154,50']), bankFormat());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statement.lines.map((l) => [l.index, l.bookingDate, l.valueDate, l.amountCents, l.counterpartyName, l.counterpartyIban, l.purpose])).toEqual([
      [1, '2026-01-02', '2026-01-02', 123450, 'Erika Beispiel', 'DE66999999991234567890', 'Spende Januar'],
      [2, '2026-01-03', '2026-01-03', -8000, 'Druckerei Muster', null, 'Flyer'],
    ]);
    expect([r.statement.from, r.statement.to, r.statement.openingCents, r.statement.closingCents]).toEqual(['2026-01-02', '2026-01-03', 100000, 215450]);
  });

  it('computes balances the same when the file is newest first', () => {
    const r = readCsv(bankFile(['03.01.2026;03.01.2026;Druckerei Muster;;Flyer;-80,00;2.154,50', '02.01.2026;02.01.2026;Erika Beispiel;;Spende;1.234,50;2.234,50']), bankFormat());
    expect(r.ok && [r.statement.openingCents, r.statement.closingCents]).toEqual([100000, 215450]);
  });

  it('refuses a file whose header does not match the format — never reads it wrongly', () => {
    expect(readCsv(enc('Datum;Betrag\n01.01.2026;1,00'), bankFormat())).toEqual({ ok: false, error: { code: 'csvHeaderMismatch' } });
  });

  it('refuses a format that names a column the header lacks, even with a matching signature', () => {
    const f = bankFormat({ columns: { ...bankFormat().columns, reference: 'Referenz' } });
    expect(readCsv(bankFile(['02.01.2026;;X;;Y;1,00;']), f)).toEqual({ ok: false, error: { code: 'csvHeaderMismatch' } });
  });

  it('names the record of a bad date, a bad amount and a short row', () => {
    expect(readCsv(bankFile(['31.02.2026;;X;;Y;1,00;']), bankFormat())).toEqual({ ok: false, error: { code: 'csvDate', line: 2 } });
    expect(readCsv(bankFile(['01.02.2026;;X;;Y;1,005;']), bankFormat())).toEqual({ ok: false, error: { code: 'csvAmount', line: 2 } });
    expect(readCsv(bankFile(['01.02.2026;;X;;Y;abc;']), bankFormat())).toEqual({ ok: false, error: { code: 'csvAmount', line: 2 } });
    expect(readCsv(bankFile(['01.02.2026;;X']), bankFormat())).toEqual({ ok: false, error: { code: 'csvRowShape', line: 2 } });
  });

  it('counts preamble records in the reported line number', () => {
    const f = bankFormat({ headerRow: 2 });
    expect(readCsv(enc(['Konto;Vereinskonto', '', BANK_HEADER, '31.02.2026;;X;;Y;1,00;'].join('\n')), f)).toEqual({ ok: false, error: { code: 'csvDate', line: 4 } });
  });

  it('counts a quoted multi-line field as one record in line numbers', () => {
    const r = readCsv(bankFile(['05.01.2026;;A;;"zwei\nZeilen";1,00;', '31.02.2026;;B;;y;1,00;']), bankFormat());
    expect(r).toEqual({ ok: false, error: { code: 'csvDate', line: 3 } });
  });

  it('reads split debit/credit columns and an S/H indicator', () => {
    const f = formatFor('Datum;Name;Zweck;Soll;Haben', { bookingDate: 'Datum', amount: null, debit: 'Soll', credit: 'Haben', counterpartyName: 'Name', purpose: 'Zweck' });
    const r = readCsv(enc('Datum;Name;Zweck;Soll;Haben\n01.03.2026;A;x;12,00;\n02.03.2026;B;y;;5,00'), f);
    expect(r.ok && r.statement.lines.map((l) => l.amountCents)).toEqual([-1200, 500]);

    const g = formatFor('Datum;Name;Betrag;S/H', { bookingDate: 'Datum', amount: 'Betrag', counterpartyName: 'Name', debitCreditIndicator: { column: 'S/H', debitValues: ['S'] } });
    const r2 = readCsv(enc('Datum;Name;Betrag;S/H\n01.03.2026;A;12,00;S\n02.03.2026;B;5,00;H'), g);
    expect(r2.ok && r2.statement.lines.map((l) => l.amountCents)).toEqual([-1200, 500]);
  });

  it('refuses a debit/credit row with both or neither side filled', () => {
    const f = formatFor('Datum;Name;Soll;Haben', { bookingDate: 'Datum', amount: null, debit: 'Soll', credit: 'Haben', counterpartyName: 'Name' });
    expect(readCsv(enc('Datum;Name;Soll;Haben\n01.03.2026;A;12,00;5,00'), f)).toEqual({ ok: false, error: { code: 'csvAmount', line: 2 } });
    expect(readCsv(enc('Datum;Name;Soll;Haben\n01.03.2026;A;;'), f)).toEqual({ ok: false, error: { code: 'csvAmount', line: 2 } });
  });

  it('reads trailing minus and parentheses as negative', () => {
    const f = formatFor('Datum;Name;Betrag', { bookingDate: 'Datum', amount: 'Betrag', counterpartyName: 'Name' });
    const r = readCsv(enc('Datum;Name;Betrag\n01.03.2026;A;12,00-\n02.03.2026;B;(5,00)\n03.03.2026;C;+7,00'), f);
    expect(r.ok && r.statement.lines.map((l) => l.amountCents)).toEqual([-1200, -500, 700]);
  });

  it('applies the sign answer of the assistant', () => {
    const r = readCsv(bankFile(['02.01.2026;;X;;Y;80,00;']), bankFormat({ invertSign: true }));
    expect(r.ok && r.statement.lines[0]!.amountCents).toBe(-8000);
  });

  it('turns a fee into a second raw line and keeps the reference apart', () => {
    const f = formatFor('Datum;Name;Brutto;Gebühr;Code', { bookingDate: 'Datum', amount: 'Brutto', counterpartyName: 'Name', fee: 'Gebühr', reference: 'Code' });
    const r = readCsv(enc('Datum;Name;Brutto;Gebühr;Code\n05.03.2026;Erika Beispiel;50,00;-1,60;TX1'), f);
    expect(r.ok && r.statement.lines.map((l) => [l.index, l.amountCents, l.counterpartyName, l.purpose, l.bankReference])).toEqual([
      [1, 5000, 'Erika Beispiel', '', 'TX1'],
      [2, -160, 'Erika Beispiel', 'Gebühr', 'TX1:fee'],
    ]);
  });

  it('keeps the sign of a refunded fee and names the purpose', () => {
    const f = formatFor('Datum;Name;Brutto;Gebühr;Code;Zweck', { bookingDate: 'Datum', amount: 'Brutto', counterpartyName: 'Name', fee: 'Gebühr', reference: 'Code', purpose: 'Zweck' });
    const r = readCsv(enc('Datum;Name;Brutto;Gebühr;Code;Zweck\n06.03.2026;Erika Beispiel;-50,00;1,60;TX2;Rückzahlung'), f);
    expect(r.ok && r.statement.lines.map((l) => [l.amountCents, l.purpose])).toEqual([[-5000, 'Rückzahlung'], [160, 'Gebühr: Rückzahlung']]);
  });

  it('refuses a non-EUR row and flags pending rows', () => {
    const f = formatFor('Datum;Name;Betrag;Währung;Status', { bookingDate: 'Datum', amount: 'Betrag', counterpartyName: 'Name', currency: 'Währung', pending: { column: 'Status', values: ['Ausstehend'] } });
    expect(readCsv(enc('Datum;Name;Betrag;Währung;Status\n05.03.2026;A;5,00;USD;Abgeschlossen'), f)).toEqual({ ok: false, error: { code: 'csvCurrency', line: 2 } });
    const r = readCsv(enc('Datum;Name;Betrag;Währung;Status\n05.03.2026;A;5,00;EUR;Ausstehend\n06.03.2026;B;7,00;eur;Abgeschlossen'), f);
    expect(r.ok && r.statement.lines.map((l) => l.pending)).toEqual([true, false]);
    expect(r.ok && [r.statement.from, r.statement.to]).toEqual(['2026-03-06', '2026-03-06']);
  });

  it('balance probe: detects a newest-first day statement and refuses a broken chain (wrong sign)', () => {
    const r = readCsv(bankFile(['05.01.2026;;B;;y;-20,00;1.080,00', '05.01.2026;;A;;x;100,00;1.100,00']), bankFormat());
    expect(r.ok && [r.statement.openingCents, r.statement.closingCents]).toEqual([100000, 108000]);
    expect(readCsv(bankFile(['05.01.2026;;A;;x;100,00;1.100,00', '06.01.2026;;B;;y;20,00;1.080,00']), bankFormat())).toEqual({ ok: false, error: { code: 'csvBalanceMismatch', line: 3 } });
  });

  it('an empty balance cell is no amount error, and its row still counts in the chain', () => {
    const r = readCsv(bankFile(['05.01.2026;;A;;x;100,00;1.100,00', '06.01.2026;;B;;y;-20,00;', '07.01.2026;;C;;z;-5,00;1.075,00']), bankFormat());
    expect(r.ok && [r.statement.openingCents, r.statement.closingCents]).toEqual([100000, 107500]);
  });

  it('the balance after a fee is the net balance', () => {
    const f = formatFor('Datum;Name;Brutto;Gebühr;Guthaben', { bookingDate: 'Datum', amount: 'Brutto', counterpartyName: 'Name', fee: 'Gebühr', balance: 'Guthaben' });
    const r = readCsv(enc('Datum;Name;Brutto;Gebühr;Guthaben\n05.03.2026;A;50,00;-1,60;148,40\n06.03.2026;B;10,00;-0,55;157,85'), f);
    expect(r.ok && [r.statement.openingCents, r.statement.closingCents]).toEqual([10000, 15785]);
  });

  it('skips zero amounts and reports an empty file', () => {
    expect(readCsv(enc(BANK_HEADER), bankFormat())).toEqual({ ok: false, error: { code: 'csvEmpty' } });
    expect(readCsv(enc(''), bankFormat())).toEqual({ ok: false, error: { code: 'csvEmpty' } });
    const r = readCsv(bankFile(['02.01.2026;;X;;Y;0,00;', '03.01.2026;;X;;Y;1,00;']), bankFormat());
    expect(r.ok && r.statement.lines.length).toBe(1);
  });

  it('reads the other date formats and a dot decimal separator', () => {
    const r = readCsv(bankFile(['2026-01-02;;X;;Y;1,234.50;']), bankFormat({ dateFormat: 'YYYY-MM-DD', decimalSeparator: '.' }));
    expect(r.ok && [r.statement.lines[0]!.bookingDate, r.statement.lines[0]!.amountCents]).toEqual(['2026-01-02', 123450]);
    const r2 = readCsv(bankFile(['02.01.26;;X;;Y;1,00;']), bankFormat({ dateFormat: 'DD.MM.YY' }));
    expect(r2.ok && r2.statement.lines[0]!.bookingDate).toBe('2026-01-02');
    const r3 = readCsv(bankFile(['02/01/2026;;X;;Y;1,00;']), bankFormat({ dateFormat: 'DD/MM/YYYY' }));
    expect(r3.ok && r3.statement.lines[0]!.bookingDate).toBe('2026-01-02');
    const r4 = readCsv(bankFile(['01/02/2026;;X;;Y;1,00;']), bankFormat({ dateFormat: 'MM/DD/YYYY' }));
    expect(r4.ok && r4.statement.lines[0]!.bookingDate).toBe('2026-01-02');
  });

  it('rejects a format with both amount and debit/credit, or with neither name nor purpose', () => {
    expect(csvFormatSchema.safeParse({ ...bankFormat(), columns: { ...bankFormat().columns, debit: 'S', credit: 'H' } }).success).toBe(false);
    expect(csvFormatSchema.safeParse({ ...bankFormat(), columns: { ...bankFormat().columns, amount: null } }).success).toBe(false);
    expect(csvFormatSchema.safeParse({ ...bankFormat(), columns: { ...bankFormat().columns, counterpartyName: null, purpose: null } }).success).toBe(false);
  });

  it('headerSignature trims, lowercases and collapses whitespace', () => {
    expect(headerSignature([' Buchungs  Tag ', 'BETRAG'])).toBe('buchungs tag|betrag');
  });
});
