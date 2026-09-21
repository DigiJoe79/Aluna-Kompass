import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { updateAccount } from '../src/ledger/accounts';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { getBalances, getIncomeStatement } from '../src/ledger/overview';
import { createPurpose, fulfillPurpose } from '../src/ledger/purposes';
import { ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('overview services', () => {
  it('is open to finance.overview and carries nothing personal', async () => {
    const f = await ledgerFixture();
    const bank = unwrap(await updateAccount(f.deps, f.ctx, { id: f.bank.id, expectedVersion: f.bank.updatedAt, openingBalanceCents: 10000, openingDate: '2026-01-01' }));
    void bank;
    const purpose = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck A', description: 'Zusage von Frau Beispiel über 2.000 €' }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, purposeId: purpose.id, contactId: f.donor.id }] }));

    const overviewCtx = ctxWith(['finance.overview'], f.userId);
    const result = unwrap(await getBalances(f.deps, overviewCtx, {}));
    const json = JSON.stringify(result);
    expect(json).not.toContain('DE02120300000000202051'); // IBAN
    expect(json).not.toContain('Zusage von Frau Beispiel'); // Freitext der Zweckbeschreibung
    expect(json).not.toContain(f.donor.id); // Spender-Kontakt
    expect(result.accounts.some((a) => a.accountId === f.bank.id)).toBe(true);
    expect(result.purposes.some((p) => p.purposeId === purpose.id)).toBe(true);
  });

  it('refuses without any finance reading right', async () => {
    const f = await ledgerFixture();
    const bare = ctxWith([], f.userId);
    expect(err(await getBalances(f.deps, bare, {}))).toEqual({ type: 'forbidden', permission: 'finance.overview' });
    expect(err(await getIncomeStatement(f.deps, bare, { fiscalYearId: f.year.id }))).toEqual({ type: 'forbidden', permission: 'finance.overview' });
  });

  it('defaults to today', async () => {
    const f = await ledgerFixture();
    const balances = unwrap(await getBalances(f.deps, f.ctx, {}));
    expect(balances.date).toBe(f.deps.clock.now().toISOString().slice(0, 10));
  });

  it('says preliminary while the fiscal year is open, and no longer once it is closed', async () => {
    const f = await ledgerFixture();
    const open = unwrap(await getIncomeStatement(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(open.preliminary).toBe(true);
    f.closeYear(f.year.id);
    const closed = unwrap(await getIncomeStatement(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(closed.preliminary).toBe(false);
  });

  it('flags a purpose in the red and a fulfilled purpose that still holds money — warnings, not locks', async () => {
    const f = await ledgerFixture();
    const inRed = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck im Minus' }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Ausgabe ohne Deckung', moneyLines: [{ accountId: f.bank.id, amountCents: -1000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1000, purposeId: inRed.id }] }));

    const fulfilled = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Erfüllt mit Rest', targetCents: 5000 }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-02', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, purposeId: fulfilled.id }] }));
    unwrap(await fulfillPurpose(f.deps, f.ctx, { id: fulfilled.id }));

    const result = unwrap(await getBalances(f.deps, f.ctx, {}));
    expect(result.purposes.find((p) => p.purposeId === inRed.id)).toMatchObject({ negative: true, fulfilledWithRest: false });
    expect(result.purposes.find((p) => p.purposeId === fulfilled.id)).toMatchObject({ negative: false, fulfilledWithRest: true });
  });

  it('takes a fiscal year or a period, not both and not neither', async () => {
    const f = await ledgerFixture();
    expect(err(await getIncomeStatement(f.deps, f.ctx, {}))).toMatchObject({ type: 'validation' });
    expect(err(await getIncomeStatement(f.deps, f.ctx, { fiscalYearId: f.year.id, from: '2026-01-01', to: '2026-12-31' }))).toMatchObject({ type: 'validation' });
    expect(err(await getIncomeStatement(f.deps, f.ctx, { from: '2026-01-01' }))).toMatchObject({ type: 'validation' });
    expect(unwrap(await getIncomeStatement(f.deps, f.ctx, { fiscalYearId: f.year.id })).preliminary).toBe(true);
    expect(unwrap(await getIncomeStatement(f.deps, f.ctx, { from: '2026-01-01', to: '2026-12-31' })).totalIncomeCents).toBe(0);
  });

  it('names its categories without a second lookup', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    const result = unwrap(await getIncomeStatement(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    expect(result.categoryNames[f.donations.id]).toBe(f.donations.name);
  });

  it('adds reviewed drafts to withReviewedCents but never to balanceCents', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-02-02', text: 'Geprueft', moneyLines: [{ accountId: f.bank.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true, expectedVersion: draft.updatedAt }));

    const result = unwrap(await getBalances(f.deps, f.ctx, {}));
    const account = result.accounts.find((a) => a.accountId === f.bank.id)!;
    expect(account.balanceCents).toBe(5000);
    expect(account.withReviewedCents).toBe(7000);
  });

  it('ignores unreviewed drafts in both', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-02-02', text: 'Unbestaetigt', moneyLines: [{ accountId: f.bank.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }] }));

    const result = unwrap(await getBalances(f.deps, f.ctx, {}));
    const account = result.accounts.find((a) => a.accountId === f.bank.id)!;
    expect(account.balanceCents).toBe(5000);
    expect(account.withReviewedCents).toBe(5000);
  });
});
