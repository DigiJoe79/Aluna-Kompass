import { readFileSync } from 'node:fs';
import path from 'node:path';
import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { buildCamt053 } from '../src/import/camt-fixture';
import { buildSecondBankCsv } from '../src/import/csv-fixture';
import { completeFormat, guessCsvFormat, headerSignature, type CsvFormat } from '../src/import/csv';
import { detectStatementAccount } from '../src/import/detect';
import { saveImportProfile } from '../src/import/profiles';
import { importStatement } from '../src/import/runs';
import { createAccount, setAccountActive } from '../src/ledger/accounts';
import { financeAccounts, financeImportRuns } from '../src/schema';
import { eq } from 'drizzle-orm';
import { setupFinance } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const camtFixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const VEREIN_IBAN = 'DE60999999990201051234';
const OTHER_IBAN = 'DE12999999990000112233';

/** Das Format, wie es der Assistent aus der Datei errät — nur das Vorzeichen beantwortet (Muster `seed.ts`). */
function guessedFormat(bytes: Uint8Array): CsvFormat {
  const guess = guessCsvFormat(bytes);
  const none: CsvFormat['columns'] = { bookingDate: '', valueDate: null, amount: null, debit: null, credit: null, debitCreditIndicator: null, counterpartyName: null, counterpartyIban: null, purpose: null, reference: null, fee: null, balance: null, currency: null, pending: null };
  return completeFormat(guess, { columns: { ...none, ...guess.columns } as CsvFormat['columns'], invertSign: false, dateFormat: guess.dateFormat!, decimalSeparator: guess.decimalSeparator! });
}

/** Zwei `Stmt` in einer Datei — CAMT erlaubt das, jede mit eigenem `Acct`. */
function camtWithTwoStatements(firstIban: string, secondIban: string): Uint8Array {
  const a = buildCamt053({ iban: firstIban, from: '2026-03-01', to: '2026-03-31', openingCents: 10000, lines: [{ bookingDate: '2026-03-02', amountCents: 500, purpose: 'A' }] });
  const b = buildCamt053({ iban: secondIban, from: '2026-03-01', to: '2026-03-31', openingCents: 20000, lines: [{ bookingDate: '2026-03-03', amountCents: -700, purpose: 'B' }] });
  const secondStmt = b.slice(b.indexOf('<Stmt>'), b.indexOf('</Stmt>') + '</Stmt>'.length);
  return new TextEncoder().encode(a.replace('</Stmt>', `</Stmt>${secondStmt}`));
}

const csv = (lines: string[]) => new TextEncoder().encode(lines.join('\n'));
const HAUSBANK_CSV = csv(['Buchungstag;Empfänger;Verwendungszweck;Betrag;Saldo', '02.03.2026;Erika Beispiel;Spende März;50,00;1.050,00']);

async function fixture() {
  const { deps, ctx } = setupFinance();
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: VEREIN_IBAN, isMain: true }));
  unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' }));
  return { deps, ctx, account };
}

const auditCount = (deps: ReturnType<typeof setupFinance>['deps']) => deps.db.select().from(schema.auditLog).all().length;

describe('detectStatementAccount', () => {
  it('detects the account of a camt file by iban', async () => {
    const f = await fixture();
    unwrap(await createAccount(f.deps, f.ctx, { name: 'Anderes Konto', kind: 'bank', iban: OTHER_IBAN }));
    const auditBefore = auditCount(f.deps);
    const res = unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'auszug.xml', bytes: camtFixture('einfach-001-02.xml') }));
    expect(res).toEqual({ kind: 'one', format: 'camt053', accountId: f.account.id });
    // Erkennen ist Lesen: kein Lauf, kein Eintrag im Änderungsprotokoll.
    expect(f.deps.db.select().from(financeImportRuns).all()).toHaveLength(0);
    expect(auditCount(f.deps)).toBe(auditBefore);

    // Zwei `Stmt` für dasselbe Konto sind ein Konto; die IBAN des Kontos zählt ohne Leerzeichen und in jeder Schreibung.
    const spaced = unwrap(await createAccount(f.deps, f.ctx, { name: 'Tagesgeld', kind: 'bank', iban: 'de59 9999 9999 0000 7777 77' }));
    const both = unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'q1.xml', bytes: camtWithTwoStatements('DE59999999990000777777', 'DE59 9999 9999 0000 7777 77') }));
    expect(both).toEqual({ kind: 'one', format: 'camt053', accountId: spaced.id });
  });

  it('detects the account of a csv file by its header signature', async () => {
    const f = await fixture();
    const second = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zweitbank', kind: 'bank', iban: 'DE48999999990000404040' }));
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: second.id, name: 'Zweitbank CSV', format: guessedFormat(buildSecondBankCsv()) }));
    const hausbank = unwrap(await createAccount(f.deps, f.ctx, { name: 'Hausbank', kind: 'bank', iban: OTHER_IBAN }));
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: hausbank.id, name: 'Hausbank CSV', format: guessedFormat(HAUSBANK_CSV) }));

    // Windows-Zeichensatz und vier Zeilen Vorspann: Die Kopfzeile steht dort, wo das Format sie sucht, nicht in Zeile 1.
    expect(unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'umsaetze.csv', bytes: buildSecondBankCsv() }))).toEqual({ kind: 'one', format: 'csv', accountId: second.id });
    expect(unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'hausbank.csv', bytes: HAUSBANK_CSV }))).toEqual({ kind: 'one', format: 'csv', accountId: hausbank.id });
  });

  it('offers both accounts when two csv formats share the header', async () => {
    const f = await fixture();
    const giro = unwrap(await createAccount(f.deps, f.ctx, { name: 'Girokonto Musterbank', kind: 'bank', iban: 'DE48999999990000404040' }));
    const savings = unwrap(await createAccount(f.deps, f.ctx, { name: 'Tagesgeld Musterbank', kind: 'bank', iban: OTHER_IBAN }));
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: giro.id, name: 'Musterbank CSV', format: guessedFormat(buildSecondBankCsv()) }));
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: savings.id, name: 'Musterbank Tagesgeld', format: guessedFormat(buildSecondBankCsv()) }));
    unwrap(await importStatement(f.deps, f.ctx, { accountId: giro.id, fileName: 'giro.csv', bytes: buildSecondBankCsv() }));
    // Ein stillgelegtes Konto mit demselben Format bietet Kompass nicht an.
    const old = unwrap(await createAccount(f.deps, f.ctx, { name: 'Altkonto', kind: 'bank', iban: 'DE30999999990000505050' }));
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: old.id, name: 'Altkonto CSV', format: guessedFormat(buildSecondBankCsv()) }));
    const oldRow = f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, old.id)).get()!;
    unwrap(await setAccountActive(f.deps, f.ctx, { id: old.id, isActive: false, expectedVersion: oldRow.updatedAt }));

    const res = unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'umsaetze_09.csv', bytes: buildSecondBankCsv() }));
    expect(res.kind).toBe('many');
    if (res.kind !== 'many') return;
    expect(res.format).toBe('csv');
    expect([...res.accounts].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { accountId: giro.id, name: 'Girokonto Musterbank', formatLabel: 'Musterbank CSV', importedThrough: '2026-03-04' },
      { accountId: savings.id, name: 'Tagesgeld Musterbank', formatLabel: 'Musterbank Tagesgeld', importedThrough: null },
    ]);
  });

  it('refuses one file with statements for two accounts', async () => {
    const f = await fixture();
    unwrap(await createAccount(f.deps, f.ctx, { name: 'Anderes Konto', kind: 'bank', iban: OTHER_IBAN }));
    const res = await detectStatementAccount(f.deps, f.ctx, { fileName: 'auszug_q1.xml', bytes: camtWithTwoStatements(VEREIN_IBAN, OTHER_IBAN) });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementMultipleAccounts' } });
    if (res.ok) return;
    // Der Grund nennt beide IBANs, die Abhilfe den Weg: je Konto eine Datei.
    expect(res.error).toMatchObject({ message: expect.stringContaining('DE60 9999 9999 0201 0512 34') });
    expect(res.error).toMatchObject({ message: expect.stringContaining('DE12 9999 9999 0000 1122 33') });
    expect(res.error).toMatchObject({ message: expect.stringContaining('je Konto eine Datei') });
    // Auch wenn nur eines der Konten eingerichtet ist — die Datei bleibt die falsche.
    const partly = await detectStatementAccount(f.deps, f.ctx, { fileName: 'auszug_q1.xml', bytes: camtWithTwoStatements(VEREIN_IBAN, 'DE18999999990000710712') });
    expect(partly).toMatchObject({ ok: false, error: { code: 'statementMultipleAccounts' } });
  });

  it('reports none with the foreign iban, and none with the header signature for an unknown csv', async () => {
    const f = await fixture();
    // Ein stillgelegtes Konto mit der IBAN zählt nicht.
    const old = unwrap(await createAccount(f.deps, f.ctx, { name: 'Altkonto', kind: 'bank', iban: 'DE18999999990000710712' }));
    const oldRow = f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, old.id)).get()!;
    unwrap(await setAccountActive(f.deps, f.ctx, { id: old.id, isActive: false, expectedVersion: oldRow.updatedAt }));
    const foreign = buildCamt053({ iban: 'DE18999999990000710712', from: '2026-03-01', to: '2026-03-31', openingCents: 0, lines: [] });
    expect(unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'auszug_03.xml', bytes: new TextEncoder().encode(foreign) }))).toEqual({
      kind: 'none', format: 'camt053', iban: 'DE18999999990000710712', headerSignature: null,
    });

    // Ein Konto ohne CSV-Format trifft keine CSV.
    const unknown = unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'export.csv', bytes: HAUSBANK_CSV }));
    expect(unknown).toEqual({ kind: 'none', format: 'csv', iban: null, headerSignature: headerSignature(['Buchungstag', 'Empfänger', 'Verwendungszweck', 'Betrag', 'Saldo']) });
  });

  it('needs finance.entriesWrite and reports an unreadable file', async () => {
    const f = await fixture();
    const denied = await detectStatementAccount(f.deps, ctxWith(['finance.read']), { fileName: 'a.xml', bytes: camtFixture('einfach-001-02.xml') });
    expect(denied).toEqual({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await detectStatementAccount(f.deps, f.ctx, { fileName: '', bytes: camtFixture('einfach-001-02.xml') })).toMatchObject({ ok: false, error: { type: 'validation' } });

    expect(unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'doctype.xml', bytes: camtFixture('doctype.xml') }))).toEqual({ kind: 'unreadable', code: 'doctypeRefused' });
    expect(unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'kein-camt.xml', bytes: camtFixture('kein-camt.xml') }))).toMatchObject({ kind: 'unreadable' });
    // Eine kaputte Zeile verhindert das Erkennen nicht: Der Lauf selbst hält sie dann als fehlgeschlagen fest.
    expect(unwrap(await detectStatementAccount(f.deps, f.ctx, { fileName: 'kaputt.xml', bytes: camtFixture('kaputte-zeile.xml') }))).toEqual({ kind: 'one', format: 'camt053', accountId: f.account.id });
  });
});
