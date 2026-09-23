import { describe, expect, it } from 'vitest';
import {
  assistantFileKey,
  buildFormat,
  canAdvance,
  initialState,
  loadState,
  previewRecords,
  saveState,
  signQuestionLine,
  storageKey,
  type AssistantState,
} from '@/lib/finance/csv-assistant-state';

const enc = (s: string) => new TextEncoder().encode(s);
const BANK = enc(['Buchungstag;Empfänger;Verwendungszweck;Betrag;Saldo', '02.01.2026;Erika Beispiel;Spende;50,00;1.050,00', '03.01.2026;Druckerei Muster;Flyer;20,00;1.030,00'].join('\n'));

/** Ein Speicher, der wie im privaten Fenster bei jedem Zugriff wirft. */
const throwingStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage;
}

describe('assistantFileKey', () => {
  it('is name, size and FNV-1a of the bytes — no crypto.subtle, which plain http lacks', () => {
    expect(assistantFileKey('a.csv', enc('a'))).toBe('a.csv:1:e40c292c');
    expect(assistantFileKey('a.csv', BANK)).toBe(assistantFileKey('a.csv', BANK.slice()));
    const changed = BANK.slice();
    changed[5] = changed[5]! ^ 1;
    expect(assistantFileKey('a.csv', changed)).not.toBe(assistantFileKey('a.csv', BANK));
  });
});

describe('initialState and buildFormat', () => {
  it('starts from the guess: settings and roles by column, sign still open', () => {
    const s = initialState(BANK, 'Vereinskonto CSV');
    expect(s.step).toBe(2);
    expect(s.settings).toMatchObject({ encoding: 'utf-8', delimiter: ';', headerRow: 0, dateFormat: 'DD.MM.YYYY', decimalSeparator: ',' });
    expect(s.roles).toEqual(['bookingDate', 'counterpartyName', 'purpose', 'amount', 'balance']);
    expect(s.invertSign).toBeNull();
    expect(s.name).toBe('Vereinskonto CSV');
  });

  it('builds a format from the roles, or names what is missing', () => {
    const s = initialState(BANK, 'Vereinskonto CSV');
    const { header } = previewRecords(BANK, s.settings);
    const ok = buildFormat(header, { ...s, invertSign: false });
    expect(ok.ok && ok.format.columns).toMatchObject({ bookingDate: 'Buchungstag', amount: 'Betrag', balance: 'Saldo' });
    expect(buildFormat(header, { ...s, roles: ['bookingDate', 'counterpartyName', 'purpose', 'ignore', 'balance'] })).toEqual({ ok: false, reason: 'amountOrDebitCredit' });
    expect(buildFormat(header, { ...s, roles: ['ignore', 'counterpartyName', 'purpose', 'amount', 'balance'] })).toEqual({ ok: false, reason: 'dateMissing' });
    expect(buildFormat(header, { ...s, roles: ['bookingDate', 'ignore', 'ignore', 'amount', 'balance'] })).toEqual({ ok: false, reason: 'nameOrPurpose' });
    expect(buildFormat(header, { ...s, roles: ['bookingDate', 'counterpartyName', 'counterpartyName', 'amount', 'balance'] })).toEqual({ ok: false, reason: 'duplicateRole' });
  });
});

describe('canAdvance', () => {
  it('step by step: settings complete, a valid mapping, a sign answer, a name', () => {
    const s = initialState(BANK, 'Vereinskonto CSV');
    const { header } = previewRecords(BANK, s.settings);
    expect(canAdvance(2, s, header)).toBe(true);
    expect(canAdvance(2, { ...s, settings: { ...s.settings, decimalSeparator: null } }, header)).toBe(false);
    expect(canAdvance(3, s, header)).toBe(true);
    expect(canAdvance(3, { ...s, roles: s.roles.map(() => 'ignore' as const) }, header)).toBe(false);
    expect(canAdvance(4, s, header)).toBe(false);
    expect(canAdvance(4, { ...s, invertSign: true }, header)).toBe(true);
    expect(canAdvance(5, { ...s, invertSign: false, name: ' ' }, header)).toBe(false);
  });
});

describe('signQuestionLine', () => {
  it('shows the first real line, read without the balance probe (a wrong sign must not hide the question)', () => {
    const s = initialState(BANK, 'Vereinskonto CSV');
    const { header } = previewRecords(BANK, s.settings);
    const built = buildFormat(header, { ...s, invertSign: false });
    if (!built.ok) throw new Error('format');
    // Die Datei führt „Flyer“ positiv, die Salden fallen aber — mit Saldenprobe wäre das ein Fehler.
    expect(signQuestionLine(BANK, built.format)).toMatchObject({ amountCents: 5000, counterpartyName: 'Erika Beispiel' });
  });
});

describe('saveState and loadState', () => {
  it('round-trip per account and file; a throwing storage is silent', () => {
    const storage = memoryStorage();
    const key = storageKey('acc1', assistantFileKey('a.csv', BANK));
    const s: AssistantState = { ...initialState(BANK, 'Vereinskonto CSV'), step: 4 };
    saveState(storage, key, s);
    expect(loadState(storage, key)).toEqual(s);
    expect(loadState(storage, storageKey('acc2', assistantFileKey('a.csv', BANK)))).toBeNull();
    expect(() => saveState(throwingStorage, key, s)).not.toThrow();
    expect(loadState(throwingStorage, key)).toBeNull();
    expect(loadState(null, key)).toBeNull();
  });
});
