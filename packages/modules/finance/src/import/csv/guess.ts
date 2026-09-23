import { BUILTIN_FORMATS, type BuiltinFormatKey } from './builtin';
import { decodeCsv, type CsvEncoding } from './decode';
import { csvFormatSchema, headerSignature, normalizeHeaderCell, type CsvFormat } from './format';
import { parseCsvDate } from './read';
import { tokenizeCsv } from './tokenize';

type Columns = CsvFormat['columns'];

export interface CsvGuess {
  encoding: CsvEncoding;
  delimiter: CsvFormat['delimiter'];
  headerRow: number;
  header: string[];
  /** Die ersten zehn Datenzeilen — Vorschau im Assistenten. */
  rows: string[][];
  dateFormat: CsvFormat['dateFormat'] | null;
  decimalSeparator: ',' | '.' | null;
  columns: Partial<Columns>;
  builtin: BuiltinFormatKey | null;
}

const DELIMITERS: CsvFormat['delimiter'][] = [';', ',', '\t', '|'];
const DATE_FORMATS: CsvFormat['dateFormat'][] = ['DD.MM.YYYY', 'DD.MM.YY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'];
const PENDING_WORDS = new Set(['ausstehend', 'vorgemerkt', 'pending']);

/**
 * Namen je Rolle, der genauere zuerst. Trifft ein Name mehr als eine Spalte,
 * bleibt die Rolle offen — geraten wird nie (F4b Task 2, Regel 6).
 */
const SYNONYMS: [Exclude<keyof Columns, 'pending' | 'debitCreditIndicator'>, string[]][] = [
  ['bookingDate', ['buchungstag', 'buchungsdatum', 'datum', 'date']],
  ['valueDate', ['valuta', 'wertstellung', 'valutadatum', 'wertstellungsdatum']],
  ['amount', ['betrag', 'betrag (eur)', 'umsatz', 'amount', 'brutto']],
  ['debit', ['soll', 'soll (eur)']],
  ['credit', ['haben', 'haben (eur)']],
  ['counterpartyName', ['auftraggeber/empfänger', 'zahlungsempfänger', 'empfänger', 'auftraggeber', 'begünstigter', 'beguenstigter', 'zahlungspflichtiger', 'name']],
  ['counterpartyIban', ['iban', 'kontonummer/iban', 'iban zahlungspflichtiger']],
  ['purpose', ['verwendungszweck', 'zweck', 'betreff', 'buchungstext', 'hinweis']],
  ['reference', ['transaktionscode', 'referenz', 'reference', 'bankreferenz']],
  ['fee', ['gebühr', 'gebuehr', 'gebühren', 'fee']],
  ['balance', ['saldo', 'kontostand', 'guthaben', 'saldo nach buchung']],
  ['currency', ['währung', 'waehrung', 'currency']],
];

function guessEncoding(bytes: Uint8Array): CsvEncoding {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

const nonBlank = (records: string[][]) => records.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));

/** Das Trennzeichen mit der häufigsten gleichbleibenden Spaltenzahl > 1. */
function guessDelimiter(text: string): CsvFormat['delimiter'] {
  let best: { delimiter: CsvFormat['delimiter']; score: number } = { delimiter: ';', score: 0 };
  for (const delimiter of DELIMITERS) {
    const counts = new Map<number, number>();
    for (const r of nonBlank(tokenizeCsv(text, delimiter))) if (r.length > 1) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    const score = Math.max(0, ...counts.values());
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

const isDate = (cell: string) => DATE_FORMATS.some((f) => parseCsvDate(cell, f) !== null);

/** Der erste Datensatz ohne Datum, dem bis zu zehn gleich breite Datensätze folgen. */
function guessHeaderRow(records: string[][]): number {
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.length < 2 || r.some((c) => isDate(c))) continue;
    const following = nonBlank(records.slice(i + 1)).slice(0, 10);
    if (following.length > 0 && following.every((f) => f.length === r.length)) return i;
  }
  return 0;
}

function guessColumns(header: string[], rows: string[][]): Partial<Columns> {
  const normalized = header.map(normalizeHeaderCell);
  const used = new Set<number>();
  const columns: Partial<Columns> = {};
  for (const [role, names] of SYNONYMS) {
    for (const name of names) {
      const hits = normalized.map((n, i) => (n === name && !used.has(i) ? i : -1)).filter((i) => i >= 0);
      if (hits.length === 0) continue;
      if (hits.length === 1) {
        columns[role] = header[hits[0]!]!.trim();
        used.add(hits[0]!);
      }
      break;
    }
  }
  const statusIndex = normalized.findIndex((n, i) => (n === 'status' || n === 'buchungsstatus') && !used.has(i));
  if (statusIndex >= 0) {
    const values = [...new Set(rows.map((r) => (r[statusIndex] ?? '').trim()).filter((v) => PENDING_WORDS.has(v.toLowerCase())))];
    if (values.length > 0) columns.pending = { column: header[statusIndex]!.trim(), values };
  }
  return columns;
}

function guessDateFormat(header: string[], rows: string[][], bookingDate: string | undefined): CsvFormat['dateFormat'] | null {
  const byName = bookingDate ? header.findIndex((h) => normalizeHeaderCell(h) === normalizeHeaderCell(bookingDate)) : -1;
  const candidates = byName >= 0 ? [byName] : header.map((_, i) => i);
  for (const col of candidates) {
    const values = rows.map((r) => (r[col] ?? '').trim()).filter((v) => v !== '');
    if (values.length === 0) continue;
    const format = DATE_FORMATS.find((f) => values.every((v) => parseCsvDate(v, f) !== null));
    if (format) return format;
  }
  return null;
}

function guessDecimal(rows: string[][]): ',' | '.' | null {
  let comma = 0;
  let dot = 0;
  for (const cell of rows.flat()) {
    const v = cell.trim();
    if (!/^[-+(]?[\d.,'\s]*\d[\d.,'\s]*\)?-?$/.test(v)) continue;
    if (/,\d{1,2}\)?-?$/.test(v)) comma += 1;
    else if (/\.\d{1,2}\)?-?$/.test(v)) dot += 1;
  }
  if (comma > dot) return ',';
  if (dot > comma) return '.';
  return null;
}

/** Kodierung, Trennzeichen, Kopfzeile, Datums- und Zahlenformat, Spalten erraten (Spec 6.2, F4b Task 2). */
export function guessCsvFormat(bytes: Uint8Array, builtins: Record<BuiltinFormatKey, { label: string; format: CsvFormat }> = BUILTIN_FORMATS): CsvGuess {
  const encoding = guessEncoding(bytes);
  const text = decodeCsv(bytes, encoding);
  const delimiter = guessDelimiter(text);
  const records = tokenizeCsv(text, delimiter);
  const headerRow = guessHeaderRow(records);
  const header = (records[headerRow] ?? []).map((h) => h.trim());
  const dataRows = nonBlank(records.slice(headerRow + 1));
  const columns = guessColumns(header, dataRows);
  const signature = headerSignature(header);
  const builtin = Object.entries(builtins).find(([, b]) => b.format.headerSignature === signature)?.[0] ?? null;
  return {
    encoding,
    delimiter,
    headerRow,
    header,
    rows: dataRows.slice(0, 10),
    dateFormat: guessDateFormat(header, dataRows, columns.bookingDate),
    decimalSeparator: guessDecimal(dataRows),
    columns,
    builtin,
  };
}

/** Aus Vermutung und Antworten des Assistenten wird ein Format; der Server prüft es beim Speichern erneut. */
export function completeFormat(guess: CsvGuess, answers: { columns: Columns; invertSign: boolean; dateFormat: CsvFormat['dateFormat']; decimalSeparator: ',' | '.' }): CsvFormat {
  return csvFormatSchema.parse({
    encoding: guess.encoding,
    delimiter: guess.delimiter,
    headerRow: guess.headerRow,
    headerSignature: headerSignature(guess.header),
    dateFormat: answers.dateFormat,
    decimalSeparator: answers.decimalSeparator,
    columns: answers.columns,
    invertSign: answers.invertSign,
  });
}
