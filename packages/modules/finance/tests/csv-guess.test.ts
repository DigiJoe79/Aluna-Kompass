import { describe, expect, it } from 'vitest';
import { completeFormat, csvFormatSchema, guessCsvFormat, headerSignature, readCsv, type CsvFormat } from '../src/import/csv';

const enc = (s: string) => new TextEncoder().encode(s);
const win1252 = (s: string) => new Uint8Array([...s].map((ch) => ({ ä: 0xe4, ö: 0xf6, ü: 0xfc, ß: 0xdf, Ä: 0xc4, Ö: 0xd6, Ü: 0xdc, '€': 0x80 })[ch] ?? ch.charCodeAt(0)));

const BANK = [
  'Kontonummer;DE23999999990000202051',
  'Zeitraum;01.01.2026 - 31.01.2026',
  '',
  'Buchungstag;Valuta;Auftraggeber/Empfänger;IBAN;Verwendungszweck;Betrag;Saldo',
  '02.01.2026;02.01.2026;Erika Beispiel;DE66999999991234567890;Spende;1.234,50;2.234,50',
  '03.01.2026;03.01.2026;Druckerei Muster;;Flyer;-80,00;2.154,50',
].join('\n');

describe('guessCsvFormat', () => {
  it('encoding: a UTF-8 BOM or valid UTF-8 is utf-8, anything else windows-1252', () => {
    expect(guessCsvFormat(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Datum;Betrag\n01.01.2026;1,00')])).encoding).toBe('utf-8');
    expect(guessCsvFormat(enc('Datum;Empfänger\n01.01.2026;Müller')).encoding).toBe('utf-8');
    expect(guessCsvFormat(win1252('Datum;Empfänger\n01.01.2026;Müller')).encoding).toBe('windows-1252');
  });

  it('delimiter: the one with a steady column count wins; a tie goes ; before , before tab before |', () => {
    expect(guessCsvFormat(enc('a,b,c\n1,2,3\n4,5,6')).delimiter).toBe(',');
    expect(guessCsvFormat(enc('a\tb\n1\t2')).delimiter).toBe('\t');
    expect(guessCsvFormat(enc('a;b,c\n1;2,3')).delimiter).toBe(';');
  });

  it('header row: skips preamble records and the blank line before the header', () => {
    const g = guessCsvFormat(enc(BANK));
    expect(g.headerRow).toBe(3);
    expect(g.header[0]).toBe('Buchungstag');
    expect(g.rows).toHaveLength(2);
  });

  it('keeps at most ten data rows for the preview', () => {
    const rows = Array.from({ length: 15 }, (_, i) => `0${(i % 9) + 1}.01.2026;${i},00`);
    expect(guessCsvFormat(enc(['Datum;Betrag', ...rows].join('\n'))).rows).toHaveLength(10);
  });

  it('date format: German dots, ISO, two-digit years', () => {
    expect(guessCsvFormat(enc(BANK)).dateFormat).toBe('DD.MM.YYYY');
    expect(guessCsvFormat(enc('Datum;Betrag\n2026-01-02;1,00')).dateFormat).toBe('YYYY-MM-DD');
    expect(guessCsvFormat(enc('Datum;Betrag\n02.01.26;1,00')).dateFormat).toBe('DD.MM.YY');
  });

  it('date format with slashes: a first part over 12 means day first, a middle part over 12 month first, otherwise day first', () => {
    expect(guessCsvFormat(enc('Datum;Betrag\n01/02/2026;1,00\n25/02/2026;1,00')).dateFormat).toBe('DD/MM/YYYY');
    expect(guessCsvFormat(enc('Datum;Betrag\n01/02/2026;1,00\n02/25/2026;1,00')).dateFormat).toBe('MM/DD/YYYY');
    expect(guessCsvFormat(enc('Datum;Betrag\n01/02/2026;1,00\n03/04/2026;1,00')).dateFormat).toBe('DD/MM/YYYY');
  });

  it('decimal separator: comma for 1.234,50, dot for 1,234.50, null when a file never shows decimals', () => {
    expect(guessCsvFormat(enc(BANK)).decimalSeparator).toBe(',');
    expect(guessCsvFormat(enc('Date,Amount\n2026-01-02,"1,234.50"\n2026-01-03,-80.00')).decimalSeparator).toBe('.');
    expect(guessCsvFormat(enc('Datum;Betrag\n02.01.2026;80')).decimalSeparator).toBeNull();
  });

  it('columns by name, preferring the more specific name; never two columns for one role', () => {
    const g = guessCsvFormat(enc(BANK));
    expect(g.columns).toMatchObject({ bookingDate: 'Buchungstag', valueDate: 'Valuta', counterpartyName: 'Auftraggeber/Empfänger', counterpartyIban: 'IBAN', purpose: 'Verwendungszweck', amount: 'Betrag', balance: 'Saldo' });
    const both = guessCsvFormat(enc('Buchungstag;Buchungstext;Verwendungszweck;Betrag\n02.01.2026;Gutschrift;Spende;1,00'));
    expect(both.columns.purpose).toBe('Verwendungszweck');
    const twice = guessCsvFormat(enc('Datum;Betrag;Betrag\n02.01.2026;1,00;2,00'));
    expect(twice.columns.amount).toBeUndefined();
  });

  it('recognises split debit/credit columns and a payment-service export with fee, reference, currency and status', () => {
    expect(guessCsvFormat(enc('Datum;Name;Soll;Haben\n01.03.2026;A;12,00;')).columns).toMatchObject({ debit: 'Soll', credit: 'Haben' });
    const g = guessCsvFormat(enc('"Datum","Name","Status","Währung","Brutto","Gebühr","Netto","Transaktionscode","Guthaben","Betreff"\n"05.03.2026","Erika Beispiel","Ausstehend","EUR","50,00","-1,60","48,40","TX1","148,40","Spende"'));
    expect(g.columns).toMatchObject({ bookingDate: 'Datum', counterpartyName: 'Name', amount: 'Brutto', fee: 'Gebühr', reference: 'Transaktionscode', balance: 'Guthaben', currency: 'Währung', purpose: 'Betreff', pending: { column: 'Status', values: ['Ausstehend'] } });
  });

  it('recognises a builtin format by its header signature', () => {
    const header = ['Datum', 'Betrag', 'Name'];
    const format: CsvFormat = csvFormatSchema.parse({
      encoding: 'utf-8', delimiter: ';', headerRow: 0, headerSignature: headerSignature(header), dateFormat: 'DD.MM.YYYY', decimalSeparator: ',',
      columns: { bookingDate: 'Datum', valueDate: null, amount: 'Betrag', debit: null, credit: null, debitCreditIndicator: null, counterpartyName: 'Name', counterpartyIban: null, purpose: null, reference: null, fee: null, balance: null, currency: null, pending: null },
      invertSign: false,
    });
    const builtins = { musterdienst: { label: 'Musterdienst', format } };
    expect(guessCsvFormat(enc('Datum;Betrag;Name\n01.01.2026;1,00;A'), builtins).builtin).toBe('musterdienst');
    expect(guessCsvFormat(enc('Datum;Betrag;Name;Extra\n01.01.2026;1,00;A;x'), builtins).builtin).toBeNull();
    expect(guessCsvFormat(enc('Datum;Betrag;Name\n01.01.2026;1,00;A')).builtin).toBeNull();
  });

  it('completeFormat turns a guess and the answers into a format that reads the file', () => {
    const g = guessCsvFormat(enc(BANK));
    const format = completeFormat(g, {
      columns: { bookingDate: 'Buchungstag', valueDate: 'Valuta', amount: 'Betrag', debit: null, credit: null, debitCreditIndicator: null, counterpartyName: 'Auftraggeber/Empfänger', counterpartyIban: 'IBAN', purpose: 'Verwendungszweck', reference: null, fee: null, balance: 'Saldo', currency: null, pending: null },
      invertSign: false,
      dateFormat: 'DD.MM.YYYY',
      decimalSeparator: ',',
    });
    const r = readCsv(enc(BANK), format);
    expect(r.ok && [r.statement.openingCents, r.statement.closingCents]).toEqual([100000, 215450]);
  });
});
