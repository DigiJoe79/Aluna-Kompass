import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { discardRun } from '../src/import/discard';
import { countOpenRawTransactionsInternal, importedThroughInternal, reconcileBankInternal } from '../src/import/queries';
import { importStatement } from '../src/import/runs';
import { createAccount } from '../src/ledger/accounts';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { installFinance } from '../src/install';
import { financeCategories, financeRawTransactions } from '../src/schema';
import { setupFinance } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const VEREIN_IBAN = 'DE60999999990201051234';

async function queriesFixture() {
  const { deps, ctx, userId } = setupFinance();
  deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: VEREIN_IBAN, isMain: true, openingBalanceCents: 100000, openingDate: '2026-01-01' }));
  unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
  const donations = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'donations')).get()!;
  const programCosts = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'program-costs')).get()!;

  const run = unwrap(await importStatement(deps, ctx, { accountId: account.id, fileName: 'maerz.xml', bytes: bytes('einfach-001-02.xml') })).runs[0]!;
  const raws = deps.db.select().from(financeRawTransactions).where(eq(financeRawTransactions.runId, run.id)).all();
  const donationRaw = raws.find((r) => r.amountCents === 20000)!;
  const expenseRaw = raws.find((r) => r.amountCents === -1500)!;
  const grantRaw = raws.find((r) => r.amountCents === -3200)!;

  return { deps, ctx, userId, account, donations, programCosts, run, donationRaw, expenseRaw, grantRaw };
}

describe('importedThroughInternal', () => {
  it('reports imported through as the end of the latest finished, undiscarded run', async () => {
    const f = await queriesFixture();
    expect(importedThroughInternal(f.deps.db, f.account.id)).toBe('2026-03-31');

    const follow = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'april.xml', bytes: bytes('folgeauszug.xml') }));
    expect(importedThroughInternal(f.deps.db, f.account.id)).toBe('2026-04-05');

    unwrap(await discardRun(f.deps, f.ctx, { id: follow.runs[0]!.id, note: 'Falsch' }));
    expect(importedThroughInternal(f.deps.db, f.account.id)).toBe('2026-03-31');
  });

  it('reports null for an account that was never imported', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const other = unwrap(await createAccount(deps, ctx, { name: 'Neu', kind: 'bank', iban: 'DE12999999990000112233' }));
    expect(importedThroughInternal(deps.db, other.id)).toBeNull();
  });
});

describe('reconcileBankInternal', () => {
  it('matches the finalized book balance against the closing balance of the run covering the date, and names the difference', async () => {
    const f = await queriesFixture();

    const differing = reconcileBankInternal(f.deps.db, f.account.id, '2026-03-20');
    expect(differing).toEqual({ state: 'differs', statementDate: '2026-03-31', bookCents: 100000, statementCents: 115300, differenceCents: 100000 - 115300, basis: 'finalized' });

    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Spende Erika', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-10', text: 'Buero', moneyLines: [{ accountId: f.account.id, amountCents: -1500, rawTransactionId: f.expenseRaw.id }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-15', text: 'Weitergeleitet', moneyLines: [{ accountId: f.account.id, amountCents: -3200, rawTransactionId: f.grantRaw.id }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -3200 }] }));

    const matching = reconcileBankInternal(f.deps.db, f.account.id, '2026-03-31');
    expect(matching).toMatchObject({ state: 'matches', statementDate: '2026-03-31', bookCents: 115300, statementCents: 115300, differenceCents: 0, basis: 'finalized' });
  });

  it('reports noStatement when no run covers the date', async () => {
    const f = await queriesFixture();
    const result = reconcileBankInternal(f.deps.db, f.account.id, '2026-02-01');
    expect(result).toEqual({ state: 'noStatement', statementDate: null, bookCents: 100000, statementCents: null, differenceCents: null, basis: 'finalized' });
  });

  it('ignores drafts in the reconciliation and says so by its basis', async () => {
    const f = await queriesFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-20', text: 'Entwurf, noch nicht festgeschrieben', moneyLines: [{ accountId: f.account.id, amountCents: 15300 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 15300 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true, expectedVersion: draft.updatedAt }));

    const result = reconcileBankInternal(f.deps.db, f.account.id, '2026-03-31');
    expect(result.basis).toBe('finalized');
    expect(result.state).toBe('differs'); // der geprüfte Entwurf zählt nicht mit — nur Festgeschriebenes
    expect(result.bookCents).toBe(100000);
  });
});

describe('countOpenRawTransactionsInternal', () => {
  it('counts raw transactions without a bound, unreleased money line', async () => {
    const f = await queriesFixture();
    expect(countOpenRawTransactionsInternal(f.deps.db, f.account.id)).toBe(3);

    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Spende Erika', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    expect(countOpenRawTransactionsInternal(f.deps.db, f.account.id)).toBe(2);
    expect(countOpenRawTransactionsInternal(f.deps.db)).toBe(2);
  });
});
