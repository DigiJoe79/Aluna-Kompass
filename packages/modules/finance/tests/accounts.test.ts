import { readSetting, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createAccount, deleteAccount, listAccounts, setAccountActive, updateAccount } from '../src/ledger/accounts';
import { financeEntries, financeMoneyLines } from '../src/schema';
import { setupFinance } from './helpers';

const BANK = { name: 'Vereinskonto', kind: 'bank' as const, iban: 'DE23 9999 9999 0000 2020 51', bic: 'BEISDEX0XXX', bankName: 'Beispielbank', isMain: true };
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('money accounts', () => {
  it('needs finance.setup to write and a reading right (overview, read or setup) to list', async () => {
    const { deps } = setupFinance();
    expect(err(await createAccount(deps, ctxWith(['finance.read']), BANK))).toEqual({ type: 'forbidden', permission: 'finance.setup' });
    expect(err(await listAccounts(deps, ctxWith(['finance.entriesWrite']), {}))).toEqual({ type: 'forbidden', permission: 'finance.overview' });
  });

  it('stores the IBAN normalized, checks it, and wants one for a bank account and none for cash', async () => {
    const { deps, ctx } = setupFinance();
    expect(unwrap(await createAccount(deps, ctx, BANK)).iban).toBe('DE23999999990000202051');
    expect(err(await createAccount(deps, ctx, { ...BANK, name: 'Zweitkonto', isMain: false, iban: 'DE24999999990000202051' }))).toMatchObject({ type: 'validation', issues: [{ path: 'iban', message: 'invalidIban' }] });
    expect(err(await createAccount(deps, ctx, { name: 'Ohne', kind: 'bank' }))).toMatchObject({ type: 'validation', issues: [{ path: 'iban', message: 'ibanRequiredForBank' }] });
    expect(err(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash', iban: BANK.iban }))).toMatchObject({ type: 'validation' });
    expect(unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' })).iban).toBeNull();
  });

  it('takes an opening balance only together with its date', async () => {
    const { deps, ctx } = setupFinance();
    expect(err(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash', openingBalanceCents: 1250 }))).toMatchObject({ type: 'validation', issues: [{ path: 'openingDate', message: 'openingDateRequired' }] });
    expect(unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash', openingBalanceCents: 1250, openingDate: '2026-01-01' }))).toMatchObject({ openingBalanceCents: 1250, openingDate: '2026-01-01' });
  });

  it('the main account writes the bank details of the association — one source', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await createAccount(deps, ctx, BANK));
    expect([readSetting(deps, 'organization.iban'), readSetting(deps, 'organization.bic'), readSetting(deps, 'organization.bankName')]).toEqual(['DE23999999990000202051', 'BEISDEX0XXX', 'Beispielbank']);
  });

  it('there is one main account: a new one takes over, and only an active bank account can be it', async () => {
    const { deps, ctx } = setupFinance();
    const first = unwrap(await createAccount(deps, ctx, BANK));
    const second = unwrap(await createAccount(deps, ctx, { ...BANK, name: 'Neues Konto', iban: 'AT93 9999 9000 0123 4567', bic: 'BKAUATWW', bankName: 'Andere Bank' }));
    const rows = unwrap(await listAccounts(deps, ctx, {}));
    expect(rows.find((a) => a.id === first.id)!.isMain).toBe(false);
    expect(rows.find((a) => a.id === second.id)!.isMain).toBe(true);
    expect(readSetting(deps, 'organization.iban')).toBe('AT939999900001234567');
    expect(err(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash', isMain: true }))).toMatchObject({ type: 'conflict', code: 'mainAccountMustBeBank' });
    expect(err(await setAccountActive(deps, ctx, { id: second.id, isActive: false }))).toMatchObject({ type: 'conflict', code: 'mainAccountMustStayActive' });
  });

  it('shows bank details only with finance.read', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await createAccount(deps, ctx, BANK));
    const [forOverview] = unwrap(await listAccounts(deps, ctxWith(['finance.overview']), {}));
    expect(forOverview).toMatchObject({ name: 'Vereinskonto', kind: 'bank', iban: null, bic: null, bankName: null });
    expect(unwrap(await listAccounts(deps, ctxWith(['finance.read']), {}))[0]!.iban).toBe('DE23999999990000202051');
  });

  it('refuses a stale update, deletes an unused account, and logs neither name nor IBAN', async () => {
    const { deps, ctx } = setupFinance();
    const account = unwrap(await createAccount(deps, ctx, { ...BANK, isMain: false }));
    expect(err(await updateAccount(deps, ctx, { id: account.id, name: 'Anders', expectedVersion: '2000-01-01T00:00:00.000Z' }))).toMatchObject({ type: 'conflict', code: 'staleVersion' });
    unwrap(await updateAccount(deps, ctx, { id: account.id, name: 'Anders', iban: 'AT93 9999 9000 0123 4567', expectedVersion: account.updatedAt }));
    unwrap(await deleteAccount(deps, ctx, { id: account.id }));
    const log = deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.account.'));
    expect(log.map((e) => e.action)).toEqual(['finance.account.create', 'finance.account.update', 'finance.account.delete']);
    expect(JSON.stringify(log)).not.toMatch(/Vereinskonto|Anders|DE23|AT93|Beispielbank|BEISDEX0/);
    expect(JSON.parse(log[1]!.after as string)).toMatchObject({ bankDetailsChanged: true });
  });

  it('cannot be deleted once a line points at it — even a draft’s', async () => {
    const { deps, ctx } = setupFinance();
    const account = unwrap(await createAccount(deps, ctx, { ...BANK, isMain: false }));
    const now = '2026-03-01T10:00:00.000Z';
    deps.db.insert(financeEntries).values({ id: 'E1', number: null, entryDate: '2026-03-01', text: 'Test', status: 'draft', createdByUserId: 'U1', createdChannel: 'ui', createdAt: now, updatedAt: now }).run();
    deps.db.insert(financeMoneyLines).values({ id: 'M1', entryId: 'E1', position: 0, accountId: account.id, amountCents: 1 }).run();
    expect(err(await deleteAccount(deps, ctx, { id: account.id }))).toMatchObject({ type: 'conflict', code: 'accountInUse' });
  });
});
