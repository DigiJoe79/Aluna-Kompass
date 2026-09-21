import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importStatement } from '../src/import/runs';
import { rawStateInternal } from '../src/import/queries';
import { createAccount } from '../src/ledger/accounts';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { reverseEntry } from '../src/ledger/reverse';
import { installFinance } from '../src/install';
import { financeCategories, financeImportRuns, financeRawTransactions } from '../src/schema';
import { setupFinance } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const VEREIN_IBAN = 'DE60999999990201051234';

const code = (r: { ok: boolean; error?: { type: string; code?: string; permission?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

async function rawFixture() {
  const { deps, ctx, userId } = setupFinance();
  deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: VEREIN_IBAN, isMain: true }));
  const cash = unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' }));
  unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
  const donations = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'donations')).get()!;
  const programCosts = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'program-costs')).get()!;

  unwrap(await importStatement(deps, ctx, { accountId: account.id, fileName: 'maerz.xml', bytes: bytes('einfach-001-02.xml') }));
  const raws = deps.db.select().from(financeRawTransactions).where(eq(financeRawTransactions.accountId, account.id)).all();
  const donationRaw = raws.find((r) => r.amountCents === 20000)!; // Spende, Erika Beispiel
  const expenseRaw = raws.find((r) => r.amountCents === -1500)!; // Bueromaterial

  return { deps, ctx, userId, account, cash, donations, programCosts, donationRaw, expenseRaw };
}

describe('a money line bound to a raw transaction', () => {
  it('binds a money line to a raw transaction of the same account, sign and amount', async () => {
    const f = await rawFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Spende Erika', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    expect(draft.moneyLines[0]!.rawTransactionId).toBe(f.donationRaw.id);
    expect(rawStateInternal(f.deps.db, f.donationRaw.id)).toBe('booked');
  });

  it('refuses a raw transaction of the wrong account, sign or amount', async () => {
    const f = await rawFixture();
    const wrongAmount = await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'x', moneyLines: [{ accountId: f.account.id, amountCents: 19999, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 19999 }] });
    expect(code(wrongAmount)).toBe('rawTransactionMismatch');

    const wrongSign = await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'x', moneyLines: [{ accountId: f.account.id, amountCents: -20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: -20000 }] });
    expect(code(wrongSign)).toBe('rawTransactionMismatch');

    const otherBank = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zweitkonto', kind: 'bank', iban: 'DE12999999990000112233' }));
    const wrongAccount = await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'x', moneyLines: [{ accountId: otherBank.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] });
    expect(code(wrongAccount)).toBe('rawTransactionMismatch');
  });

  it('refuses a second entry, even a draft, on the same raw transaction', async () => {
    const f = await rawFixture();
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Erster Entwurf', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    const second = await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Zweiter Entwurf', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] });
    expect(code(second)).toBe('rawTransactionTaken');
  });

  it('lets the same draft be saved again with its raw transaction', async () => {
    const f = await rawFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Entwurf', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    const savedAgain = await saveDraft(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.updatedAt, entryDate: '2026-03-07', text: 'Entwurf geaendert', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] });
    expect(code(savedAgain)).toBe('ok');
  });

  it('frees the raw transaction again when its finalized entry is taken back', async () => {
    const f = await rawFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Spende Erika', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    expect(rawStateInternal(f.deps.db, f.donationRaw.id)).toBe('booked');

    unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    expect(rawStateInternal(f.deps.db, f.donationRaw.id)).toBe('open');

    // Frei — laesst sich neu binden.
    const rebound = await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-08', text: 'Erneut', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] });
    expect(code(rebound)).toBe('ok');
  });

  it('reports a raw transaction as booked only while an unreversed entry points to it', async () => {
    const f = await rawFixture();
    expect(rawStateInternal(f.deps.db, f.expenseRaw.id)).toBe('open');
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-10', text: 'Buero', moneyLines: [{ accountId: f.account.id, amountCents: -1500, rawTransactionId: f.expenseRaw.id }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    // Ein Entwurf zaehlt schon als „booked“ fuer die Sperre (F4 Task 4) — die Anzeige unterscheidet erst F5.
    expect(rawStateInternal(f.deps.db, f.expenseRaw.id)).toBe('booked');
    expect(draft.status).toBe('draft');
  });

  it('refuses a raw transaction of a discarded run', async () => {
    const f = await rawFixture();
    const run = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.accountId, f.account.id)).get()!;
    f.deps.db.update(financeImportRuns).set({ discardedAt: '2026-04-01T00:00:00.000Z', discardedByUserId: f.userId, discardNote: 'Test' }).where(eq(financeImportRuns.id, run.id)).run();

    const res = await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'x', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] });
    expect(code(res)).toBe('rawTransactionDiscarded');
  });
});
