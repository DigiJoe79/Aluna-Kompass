import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { csvFormatSchema, headerSignature, type CsvFormat } from '../src/import/csv';
import { listImportProfiles, saveImportProfile } from '../src/import/profiles';
import { createAccount, setImportFormatInternal } from '../src/ledger/accounts';
import { financeAccounts, financeImportProfiles } from '../src/schema';
import { ledgerFixture } from './helpers';

const HEADER = ['Buchungstag', 'Name', 'Verwendungszweck', 'Betrag'];

function format(header: readonly string[] = HEADER): CsvFormat {
  return csvFormatSchema.parse({
    encoding: 'utf-8', delimiter: ';', headerRow: 0, headerSignature: headerSignature(header), dateFormat: 'DD.MM.YYYY', decimalSeparator: ',',
    columns: { bookingDate: 'Buchungstag', valueDate: null, amount: 'Betrag', debit: null, credit: null, debitCreditIndicator: null, counterpartyName: 'Name', counterpartyIban: null, purpose: 'Verwendungszweck', reference: null, fee: null, balance: null, currency: null, pending: null },
    invertSign: false,
  });
}

const accountRow = (f: Awaited<ReturnType<typeof ledgerFixture>>, id: string) => f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, id)).get()!;

describe('saveImportProfile', () => {
  it('needs finance.setup', async () => {
    const f = await ledgerFixture();
    const r = await saveImportProfile(f.deps, ctxWith(['finance.entriesWrite', 'finance.read']), { accountId: f.bank.id, name: 'Bank CSV', format: format() });
    expect(r).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.setup' } });
  });

  it('only for an active bank or payment-service account', async () => {
    const f = await ledgerFixture();
    expect(await saveImportProfile(f.deps, f.ctx, { accountId: f.cash.id, name: 'Kasse', format: format() })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementAccountNotBank' } });
  });

  it('refuses an invalid format with a field error', async () => {
    const f = await ledgerFixture();
    const bad = { ...format(), columns: { ...format().columns, amount: null } };
    expect(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: bad })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('makes the new format the only active one of an account without a format', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() }));
    expect(accountRow(f, f.bank.id)).toMatchObject({ importFormat: 'csv', importProfileId: saved.profileId });
  });

  it('switching from CAMT needs a confirmation', async () => {
    const f = await ledgerFixture();
    f.deps.db.transaction((tx) => setImportFormatInternal(tx, f.deps, f.ctx, accountRow(f, f.bank.id), 'camt053', null));
    expect(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementFormatChange' } });
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format(), confirmFormatChange: true }));
    expect(accountRow(f, f.bank.id).importFormat).toBe('csv');
  });

  it('a format with another header is a switch; the same header (a corrected mapping) is not', async () => {
    const f = await ledgerFixture();
    const first = unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() }));
    const corrected = { ...format(), invertSign: true };
    const second = unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV korrigiert', format: corrected }));
    expect(second.profileId).not.toBe(first.profileId);
    const other = format(['Buchungstag', 'Name', 'Verwendungszweck', 'Betrag', 'Saldo']);
    expect(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Neue Bank', format: other })).toMatchObject({ ok: false, error: { code: 'statementFormatChange' } });
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Neue Bank', format: other, confirmFormatChange: true }));
  });

  it('writes the audit log without column names or the typed format name — only ids, encoding, delimiter and a checksum of the header', async () => {
    const f = await ledgerFixture();
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() }));
    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.importProfile.save');
    expect(log).toHaveLength(1);
    expect(JSON.stringify(log)).not.toMatch(/Buchungstag|Verwendungszweck|Betrag|Bank CSV/);
    expect(JSON.parse(log[0]!.after as string)).toMatchObject({ accountId: f.bank.id, encoding: 'utf-8', delimiter: ';', switched: false });
    expect(JSON.parse(log[0]!.after as string).headerChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a saved format never changes — an update is refused by the database', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() }));
    expect(() => f.deps.db.update(financeImportProfiles).set({ name: 'Anders' }).where(eq(financeImportProfiles.id, saved.profileId)).run()).toThrow(/immutable/);
    expect(() => f.deps.db.delete(financeImportProfiles).where(eq(financeImportProfiles.id, saved.profileId)).run()).toThrow(/in use/);
  });
});

describe('account and format stay consistent', () => {
  it('an account cannot be csv without a format, nor carry a format without csv', async () => {
    const f = await ledgerFixture();
    expect(() => f.deps.db.update(financeAccounts).set({ importFormat: 'csv' }).where(eq(financeAccounts.id, f.bank.id)).run()).toThrow(/import format/);
    const saved = unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() }));
    expect(() => f.deps.db.update(financeAccounts).set({ importFormat: 'camt053' }).where(eq(financeAccounts.id, f.bank.id)).run()).toThrow(/import format/);
    expect(() => f.deps.db.update(financeAccounts).set({ importProfileId: 'gibt-es-nicht' }).where(eq(financeAccounts.id, f.bank.id)).run()).toThrow(/import format/);
    expect(saved.profileId).toBeTruthy();
  });

  it('setImportFormatInternal switches both fields in one statement, both ways', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() }));
    f.deps.db.transaction((tx) => setImportFormatInternal(tx, f.deps, f.ctx, accountRow(f, f.bank.id), 'camt053', null));
    expect(accountRow(f, f.bank.id)).toMatchObject({ importFormat: 'camt053', importProfileId: null });
    f.deps.db.transaction((tx) => setImportFormatInternal(tx, f.deps, f.ctx, accountRow(f, f.bank.id), 'csv', saved.profileId));
    expect(accountRow(f, f.bank.id)).toMatchObject({ importFormat: 'csv', importProfileId: saved.profileId });
  });

  it('a new account with csv but no format is refused', async () => {
    const f = await ledgerFixture();
    expect(() => f.deps.db.insert(financeAccounts).values({ id: 'x', name: 'X', kind: 'bank', importFormat: 'csv', isMain: false, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }).run()).toThrow(/import format/);
    expect((await createAccount(f.deps, f.ctx, { name: 'Neu', kind: 'bank', iban: 'DE66999999991234567890', importFormat: 'csv' })).ok).toBe(false);
  });
});

describe('listImportProfiles', () => {
  it('lists formats with the accounts they are active for; setup or read may list', async () => {
    const f = await ledgerFixture();
    const old = unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() }));
    const now = unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV 2', format: { ...format(), invertSign: true } }));
    const { profiles } = unwrap(await listImportProfiles(f.deps, ctxWith(['finance.setup']), {}));
    expect(profiles.find((p) => p.id === now.profileId)).toMatchObject({ name: 'Bank CSV 2', activeForAccountIds: [f.bank.id], runCount: 0 });
    expect(profiles.find((p) => p.id === old.profileId)).toMatchObject({ activeForAccountIds: [] });
    expect((await listImportProfiles(f.deps, ctxWith(['finance.read']), {})).ok).toBe(true);
    expect((await listImportProfiles(f.deps, ctxWith(['finance.overview']), {})).ok).toBe(false);
  });

  it('the rows really are in finance_import_profiles', async () => {
    const f = await ledgerFixture();
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Bank CSV', format: format() }));
    expect(f.deps.db.select().from(financeImportProfiles).all()).toHaveLength(1);
  });
});
