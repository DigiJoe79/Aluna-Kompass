import {
  csvFormatSchema,
  decodeCsv,
  guessCsvFormat,
  headerSignature,
  readCsv,
  tokenizeCsv,
  type CsvEncoding,
  type CsvFormat,
  type CsvLine,
} from '@kompass/module-finance/csv';

/**
 * Der Stand des CSV-Assistenten (F4b Task 5, HANDOFF § 12.3) als reine
 * Funktionen. Nur aus `@kompass/module-finance/csv` — der Assistent läuft im
 * Browser, und dieser Unterpfad lädt weder den Kern noch die Datenbank.
 */
export type AssistantStep = 1 | 2 | 3 | 4 | 5;

export type ColumnRole =
  | 'ignore'
  | 'bookingDate'
  | 'valueDate'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'indicator'
  | 'counterpartyName'
  | 'counterpartyIban'
  | 'purpose'
  | 'reference'
  | 'fee'
  | 'balance'
  | 'currency'
  | 'pending';

export const COLUMN_ROLES: readonly ColumnRole[] = ['ignore', 'bookingDate', 'valueDate', 'amount', 'debit', 'credit', 'indicator', 'counterpartyName', 'counterpartyIban', 'purpose', 'reference', 'fee', 'balance', 'currency', 'pending'];

export interface AssistantSettings {
  encoding: CsvEncoding;
  delimiter: CsvFormat['delimiter'];
  headerRow: number;
  dateFormat: CsvFormat['dateFormat'] | null;
  decimalSeparator: ',' | '.' | null;
}

export interface AssistantState {
  step: AssistantStep;
  settings: AssistantSettings;
  /** Rolle je Spalte der Kopfzeile, in ihrer Reihenfolge. */
  roles: ColumnRole[];
  /** Werte des Kennzeichens, die „Ausgang“ bedeuten, durch Komma getrennt. */
  indicatorValues: string;
  /** Werte der Statusspalte, die „vorgemerkt“ bedeuten, durch Komma getrennt. */
  pendingValues: string;
  /** Antwort auf die Vorzeichenfrage: Die Datei führt Ausgänge positiv. `null` = noch offen. */
  invertSign: boolean | null;
  name: string;
}

export type BuildFailure = 'dateMissing' | 'amountOrDebitCredit' | 'nameOrPurpose' | 'duplicateRole' | 'indicatorValues' | 'pendingValues' | 'settingsMissing';

/** FNV-1a, 32 Bit — ein Schlüssel, kein Schutz. `crypto.subtle` fehlt über Klartext-HTTP (NAS-Testinstanz). */
function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function assistantFileKey(name: string, bytes: Uint8Array): string {
  return `${name}:${bytes.length}:${fnv1a(bytes)}`;
}

export function storageKey(accountId: string, fileKey: string): string {
  return `finance.csvAssistant.${accountId}.${fileKey}`;
}

/** Kopfzeile und die ersten zehn Datenzeilen mit den gewählten Einstellungen — für die Vorschau. */
export function previewRecords(bytes: Uint8Array, settings: Pick<AssistantSettings, 'encoding' | 'delimiter' | 'headerRow'>): { header: string[]; rows: string[][] } {
  const records = tokenizeCsv(decodeCsv(bytes, settings.encoding), settings.delimiter);
  const header = (records[settings.headerRow] ?? []).map((h) => h.trim());
  const rows = records
    .slice(settings.headerRow + 1)
    .filter((r) => !(r.length === 1 && r[0]!.trim() === ''))
    .slice(0, 10);
  return { header, rows };
}

/** Der Assistent beginnt mit dem, was Kompass errät (Schritt 2); `defaultName` kommt aus der Sprachdatei. */
export function initialState(bytes: Uint8Array, defaultName: string): AssistantState {
  const guess = guessCsvFormat(bytes);
  const roleByName = new Map<string, ColumnRole>();
  for (const [role, value] of Object.entries(guess.columns)) {
    if (value === null || value === undefined) continue;
    if (role === 'pending' || role === 'debitCreditIndicator') {
      const column = (value as { column: string }).column;
      roleByName.set(column, role === 'pending' ? 'pending' : 'indicator');
    } else {
      roleByName.set(value as string, role as ColumnRole);
    }
  }
  return {
    step: 2,
    settings: { encoding: guess.encoding, delimiter: guess.delimiter, headerRow: guess.headerRow, dateFormat: guess.dateFormat, decimalSeparator: guess.decimalSeparator },
    roles: guess.header.map((h) => roleByName.get(h) ?? 'ignore'),
    indicatorValues: '',
    pendingValues: guess.columns.pending?.values.join(', ') ?? '',
    invertSign: null,
    name: defaultName,
  };
}

const splitValues = (text: string) => text.split(',').map((v) => v.trim()).filter((v) => v !== '');

/** Aus Einstellungen und Rollen ein Format — oder der Grund, warum noch nicht. */
export function buildFormat(header: string[], state: AssistantState): { ok: true; format: CsvFormat } | { ok: false; reason: BuildFailure } {
  const { settings } = state;
  if (settings.dateFormat === null || settings.decimalSeparator === null) return { ok: false, reason: 'settingsMissing' };
  const byRole = new Map<ColumnRole, string>();
  for (let i = 0; i < header.length; i++) {
    const role = state.roles[i] ?? 'ignore';
    if (role === 'ignore') continue;
    if (byRole.has(role)) return { ok: false, reason: 'duplicateRole' };
    byRole.set(role, header[i]!);
  }
  const col = (role: ColumnRole) => byRole.get(role) ?? null;
  if (!col('bookingDate')) return { ok: false, reason: 'dateMissing' };
  const single = col('amount') !== null;
  const split = col('debit') !== null && col('credit') !== null;
  if (single === split || (!single && (col('debit') === null) !== (col('credit') === null))) return { ok: false, reason: 'amountOrDebitCredit' };
  if (!col('counterpartyName') && !col('purpose')) return { ok: false, reason: 'nameOrPurpose' };
  const indicatorValues = splitValues(state.indicatorValues);
  if (col('indicator') && indicatorValues.length === 0) return { ok: false, reason: 'indicatorValues' };
  const pendingValues = splitValues(state.pendingValues);
  if (col('pending') && pendingValues.length === 0) return { ok: false, reason: 'pendingValues' };

  const parsed = csvFormatSchema.safeParse({
    encoding: settings.encoding,
    delimiter: settings.delimiter,
    headerRow: settings.headerRow,
    headerSignature: headerSignature(header),
    dateFormat: settings.dateFormat,
    decimalSeparator: settings.decimalSeparator,
    columns: {
      bookingDate: col('bookingDate'),
      valueDate: col('valueDate'),
      amount: col('amount'),
      debit: col('debit'),
      credit: col('credit'),
      debitCreditIndicator: col('indicator') ? { column: col('indicator'), debitValues: indicatorValues } : null,
      counterpartyName: col('counterpartyName'),
      counterpartyIban: col('counterpartyIban'),
      purpose: col('purpose'),
      reference: col('reference'),
      fee: col('fee'),
      balance: col('balance'),
      currency: col('currency'),
      pending: col('pending') ? { column: col('pending'), values: pendingValues } : null,
    },
    invertSign: state.invertSign ?? false,
  });
  return parsed.success ? { ok: true, format: parsed.data } : { ok: false, reason: 'amountOrDebitCredit' };
}

/** Darf der Assistent von diesem Schritt weiter? Schritt 1 regelt die Dateiwahl selbst. */
export function canAdvance(step: AssistantStep, state: AssistantState, header: string[]): boolean {
  switch (step) {
    case 1:
      return true;
    case 2:
      return state.settings.dateFormat !== null && state.settings.decimalSeparator !== null && header.length > 1;
    case 3:
      return buildFormat(header, state).ok;
    case 4:
      return state.invertSign !== null;
    case 5:
      return state.name.trim() !== '' && buildFormat(header, state).ok && state.invertSign !== null;
  }
}

/**
 * Die Zeile für die Vorzeichenfrage: die erste mit Betrag, gelesen **ohne**
 * Saldenprobe — ein falsches Vorzeichen bricht die Probe, und dann gäbe es gar
 * keine Zeile zum Fragen.
 */
export function signQuestionLine(bytes: Uint8Array, format: CsvFormat): CsvLine | null {
  const read = readCsv(bytes, { ...format, invertSign: false, columns: { ...format.columns, balance: null } });
  return read.ok ? (read.statement.lines.find((l) => l.amountCents !== 0) ?? null) : null;
}

export function saveState(storage: Storage | null, key: string, state: AssistantState): void {
  try {
    storage?.setItem(key, JSON.stringify(state));
  } catch {
    // Privates Fenster, gesperrter Speicher: Der Assistent läuft weiter, nur ohne Wiederaufnahme.
  }
}

export function loadState(storage: Storage | null, key: string): AssistantState | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as AssistantState) : null;
  } catch {
    return null;
  }
}
