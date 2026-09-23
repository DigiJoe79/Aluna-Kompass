import { decodeCsv } from './decode';
import { headerSignature, normalizeHeaderCell, type CsvFormat } from './format';
import { tokenizeCsv } from './tokenize';

export type CsvErrorCode = 'csvEmpty' | 'csvHeaderMismatch' | 'csvRowShape' | 'csvDate' | 'csvAmount' | 'csvCurrency' | 'csvBalanceMismatch';

/**
 * Eine Zeile, wie sie der Laufdienst bekommt — strukturgleich mit `CamtLine`
 * (`import/camt.ts`), aber hier eigens deklariert: Der CSV-Kern lädt nichts
 * außerhalb von `csv/`. Ein Typtest prüft die Zuweisbarkeit.
 */
export interface CsvLine {
  index: number;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  purpose: string;
  bankReference: string | null;
  endToEndId: null;
  returnCode: null;
  pending: boolean;
}

export interface CsvStatement {
  from: string;
  to: string;
  openingCents: number | null;
  closingCents: number | null;
  lines: CsvLine[];
}

export type CsvReadResult = { ok: true; statement: CsvStatement } | { ok: false; error: { code: CsvErrorCode; line?: number } };

const fail = (code: CsvErrorCode, line?: number): CsvReadResult => ({ ok: false, error: line === undefined ? { code } : { code, line } });

const DATE_PATTERNS: Record<CsvFormat['dateFormat'], { re: RegExp; order: ['d' | 'm' | 'y', 'd' | 'm' | 'y', 'd' | 'm' | 'y'] }> = {
  'DD.MM.YYYY': { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ['d', 'm', 'y'] },
  'DD.MM.YY': { re: /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, order: ['d', 'm', 'y'] },
  'YYYY-MM-DD': { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ['y', 'm', 'd'] },
  'DD/MM/YYYY': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['d', 'm', 'y'] },
  'MM/DD/YYYY': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['m', 'd', 'y'] },
};

/** ISO-Datum oder `null`, wenn der Wert nicht in das Format passt oder kein Kalendertag ist (31.02.). */
export function parseCsvDate(value: string, format: CsvFormat['dateFormat']): string | null {
  const { re, order } = DATE_PATTERNS[format];
  const m = re.exec(value.trim());
  if (!m) return null;
  const parts: Record<'d' | 'm' | 'y', number> = { d: 0, m: 0, y: 0 };
  order.forEach((key, i) => (parts[key] = Number(m[i + 1])));
  if (format === 'DD.MM.YY') parts.y += 2000;
  const date = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  if (date.getUTCFullYear() !== parts.y || date.getUTCMonth() !== parts.m - 1 || date.getUTCDate() !== parts.d) return null;
  return `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}

/**
 * Betrag in Cent. `null` für eine leere Zelle, `undefined` für eine, die kein
 * Betrag ist. Negativ sind führendes oder nachgestelltes Minus und `(…)`;
 * Tausendertrenner (der andere Separator, `'`, Leerzeichen) fallen weg;
 * höchstens zwei Nachkommastellen.
 */
export function parseCsvAmount(value: string, decimal: ',' | '.'): number | null | undefined {
  let v = value.trim().replace(/[  ]/g, ' ');
  if (v === '') return null;
  let negative = false;
  if (v.startsWith('(') && v.endsWith(')')) {
    negative = true;
    v = v.slice(1, -1).trim();
  }
  if (v.startsWith('-')) {
    negative = !negative;
    v = v.slice(1).trim();
  } else if (v.startsWith('+')) {
    v = v.slice(1).trim();
  } else if (v.endsWith('-')) {
    negative = !negative;
    v = v.slice(0, -1).trim();
  }
  const thousands = decimal === ',' ? '.' : ',';
  v = v.split(thousands).join('').replace(/['\s]/g, '');
  if (decimal === ',') v = v.replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return undefined;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return negative ? -cents : cents;
}

interface Row {
  line: number;
  date: string;
  net: number;
  balance: number | null;
  pending: boolean;
}

/**
 * Eine CSV-Datei mit einem Format lesen — ganz oder gar nicht (Spec 6.1,
 * 6.2). Zeilenangaben sind Datensatznummern ab 1, Vorspann und Kopfzeile
 * mitgezählt; ein Feld mit Zeilenumbruch bleibt ein Datensatz.
 */
export function readCsv(bytes: Uint8Array, format: CsvFormat): CsvReadResult {
  const records = tokenizeCsv(decodeCsv(bytes, format.encoding), format.delimiter);
  if (records.length <= format.headerRow) return fail('csvEmpty');
  const header = records[format.headerRow]!;
  if (headerSignature(header) !== format.headerSignature) return fail('csvHeaderMismatch');

  const normalized = header.map(normalizeHeaderCell);
  const indexOf = (name: string | null): number | null | undefined => {
    if (name === null) return null;
    const i = normalized.indexOf(normalizeHeaderCell(name));
    return i < 0 ? undefined : i;
  };
  const c = format.columns;
  const idx = {
    bookingDate: indexOf(c.bookingDate),
    valueDate: indexOf(c.valueDate),
    amount: indexOf(c.amount),
    debit: indexOf(c.debit),
    credit: indexOf(c.credit),
    indicator: indexOf(c.debitCreditIndicator?.column ?? null),
    name: indexOf(c.counterpartyName),
    iban: indexOf(c.counterpartyIban),
    purpose: indexOf(c.purpose),
    reference: indexOf(c.reference),
    fee: indexOf(c.fee),
    balance: indexOf(c.balance),
    currency: indexOf(c.currency),
    pending: indexOf(c.pending?.column ?? null),
  };
  if (Object.values(idx).some((i) => i === undefined)) return fail('csvHeaderMismatch');
  const cell = (row: string[], i: number | null | undefined): string => (i === null || i === undefined ? '' : (row[i] ?? '').trim());

  const debitValues = new Set((c.debitCreditIndicator?.debitValues ?? []).map((v) => v.trim().toLowerCase()));
  const pendingValues = new Set((c.pending?.values ?? []).map((v) => v.trim().toLowerCase()));
  const sign = format.invertSign ? -1 : 1;

  const lines: CsvLine[] = [];
  const rows: Row[] = [];
  let sawData = false;

  for (let r = format.headerRow + 1; r < records.length; r++) {
    const record = records[r]!;
    const line = r + 1;
    if (record.length === 1 && record[0]!.trim() === '') continue;
    sawData = true;
    if (record.length !== header.length) return fail('csvRowShape', line);

    const bookingDate = parseCsvDate(cell(record, idx.bookingDate), format.dateFormat);
    if (!bookingDate) return fail('csvDate', line);
    const valueRaw = cell(record, idx.valueDate);
    const valueDate = valueRaw === '' ? null : parseCsvDate(valueRaw, format.dateFormat);
    if (valueRaw !== '' && !valueDate) return fail('csvDate', line);

    if (idx.currency !== null && cell(record, idx.currency).toUpperCase() !== 'EUR') return fail('csvCurrency', line);
    const pending = idx.pending !== null && pendingValues.has(cell(record, idx.pending).toLowerCase());

    let amount: number;
    if (idx.amount !== null) {
      const parsed = parseCsvAmount(cell(record, idx.amount), format.decimalSeparator);
      if (parsed === null || parsed === undefined) return fail('csvAmount', line);
      amount = idx.indicator !== null && debitValues.has(cell(record, idx.indicator).toLowerCase()) ? -Math.abs(parsed) : parsed;
    } else {
      const debit = parseCsvAmount(cell(record, idx.debit), format.decimalSeparator);
      const credit = parseCsvAmount(cell(record, idx.credit), format.decimalSeparator);
      if (debit === undefined || credit === undefined || (debit === null) === (credit === null)) return fail('csvAmount', line);
      amount = debit !== null ? -Math.abs(debit) : Math.abs(credit!);
    }
    amount *= sign;

    let fee = 0;
    if (idx.fee !== null) {
      const parsedFee = parseCsvAmount(cell(record, idx.fee), format.decimalSeparator);
      if (parsedFee === undefined) return fail('csvAmount', line);
      fee = (parsedFee ?? 0) * sign;
    }
    let balance: number | null = null;
    if (idx.balance !== null) {
      const parsedBalance = parseCsvAmount(cell(record, idx.balance), format.decimalSeparator);
      if (parsedBalance === undefined) return fail('csvAmount', line);
      balance = parsedBalance;
    }

    const name = cell(record, idx.name) || null;
    const ibanRaw = cell(record, idx.iban).replace(/\s+/g, '').toUpperCase();
    const purpose = cell(record, idx.purpose).replace(/\s+/g, ' ').trim();
    const reference = cell(record, idx.reference) || null;
    const base = { bookingDate, valueDate, counterpartyName: name, counterpartyIban: ibanRaw || null, endToEndId: null, returnCode: null, pending } as const;

    if (amount !== 0) lines.push({ ...base, index: lines.length + 1, amountCents: amount, purpose, bankReference: reference });
    if (fee !== 0) lines.push({ ...base, index: lines.length + 1, amountCents: fee, purpose: purpose ? `Gebühr: ${purpose}` : 'Gebühr', bankReference: reference ? `${reference}:fee` : null });
    rows.push({ line, date: bookingDate, net: pending ? 0 : amount + fee, balance: pending ? null : balance, pending });
  }

  if (!sawData || lines.length === 0) return fail('csvEmpty');

  const booked = lines.filter((l) => !l.pending);
  const dates = (booked.length > 0 ? booked : lines).map((l) => l.bookingDate).sort();
  const balances = probeBalances(rows);
  if (!balances.ok) return fail('csvBalanceMismatch', balances.line);

  return { ok: true, statement: { from: dates[0]!, to: dates[dates.length - 1]!, openingCents: balances.opening, closingCents: balances.closing, lines } };
}

/**
 * Saldenprobe (F4b): Jede Zeile mit Saldo muss zur vorigen passen — Zeilen
 * ohne Saldo dazwischen zählen mit. Aus der Kette folgt auch die Reihenfolge
 * der Datei, selbst wenn alle Zeilen denselben Tag tragen.
 */
function probeBalances(rows: Row[]): { ok: true; opening: number | null; closing: number | null } | { ok: false; line: number } {
  const probes = rows.map((row, i) => ({ row, i })).filter((p) => p.row.balance !== null);
  if (probes.length === 0) return { ok: true, opening: null, closing: null };
  const sumNet = (from: number, to: number) => rows.slice(from, to).reduce((s, r) => s + r.net, 0);

  let ascending = true;
  let firstBreak: number | null = null;
  let descending = true;
  for (let k = 1; k < probes.length; k++) {
    const p = probes[k - 1]!;
    const q = probes[k]!;
    if (q.row.balance !== p.row.balance! + sumNet(p.i + 1, q.i + 1)) {
      ascending = false;
      firstBreak ??= q.row.line;
    }
    if (p.row.balance !== q.row.balance! + sumNet(p.i, q.i)) descending = false;
  }
  if (!ascending && !descending) return { ok: false, line: firstBreak! };

  const total = sumNet(0, rows.length);
  const closing = ascending
    ? probes[probes.length - 1]!.row.balance! + sumNet(probes[probes.length - 1]!.i + 1, rows.length)
    : probes[0]!.row.balance! + sumNet(0, probes[0]!.i);
  return { ok: true, opening: closing - total, closing };
}
