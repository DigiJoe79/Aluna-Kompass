import { newId, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { firstNegativeCashDay, formatEuro } from '../src/ledger/cash-check';
import { financeEntries, financeMoneyLines, type FinanceAccountRow } from '../src/schema';
import { setupFinance } from './helpers';

/** Kopf und Geldzeile direkt in die Tabellen — die Kassenprüfung soll nicht von Task 7 (Festschreiben) abhängen. */
function bookLine(deps: ReturnType<typeof setupFinance>['deps'], accountId: string, entryDate: string, amountCents: number, status: 'draft' | 'final' = 'final') {
  const entryId = newId();
  const lineId = newId();
  const now = `${entryDate}T00:00:00.000Z`;
  deps.db.insert(financeEntries).values({ id: entryId, number: null, entryDate, text: 'Test', status: 'draft', createdByUserId: 'U1', createdChannel: 'ui', createdAt: now, updatedAt: now }).run();
  deps.db.insert(financeMoneyLines).values({ id: lineId, entryId, position: 0, accountId, amountCents }).run();
  if (status === 'final') {
    deps.db.update(financeEntries).set({ status: 'final', number: newId(), finalizedAt: now, finalizedByUserId: 'U1', finalizedChannel: 'ui' }).where(eq(financeEntries.id, entryId)).run();
  }
}

async function cashAccount(deps: ReturnType<typeof setupFinance>['deps'], ctx: ReturnType<typeof setupFinance>['ctx'], opts: { openingBalanceCents?: number; openingDate?: string } = {}): Promise<FinanceAccountRow> {
  return unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash', ...opts }));
}

describe('firstNegativeCashDay', () => {
  it('is calm while every day ends at zero or above', async () => {
    const { deps, ctx } = setupFinance();
    // Anfangsbestand 100,00 € am 01.01.; −40,00 € am 03.01. (Rest 60,00 €); −60,00 € am 05.01. (Rest 0,00 €) — nie negativ.
    const account = await cashAccount(deps, ctx, { openingBalanceCents: 10000, openingDate: '2026-01-01' });
    bookLine(deps, account.id, '2026-01-03', -4000);
    bookLine(deps, account.id, '2026-01-05', -6000);
    expect(firstNegativeCashDay(deps.db, account, '2026-01-01', [])).toBeNull();
  });

  it('names the first day that would end below zero', async () => {
    const { deps, ctx } = setupFinance();
    const account = await cashAccount(deps, ctx, { openingBalanceCents: 10000, openingDate: '2026-01-01' });
    bookLine(deps, account.id, '2026-01-03', -4000);
    bookLine(deps, account.id, '2026-01-05', -6000);
    // Dazu −10,00 € am 04.01.: 60,00 − 10,00 = 50,00 am 04.; 50,00 − 60,00 = −10,00 am 05. → negativ.
    const extra = [{ date: '2026-01-04', amountCents: -1000 }];
    expect(firstNegativeCashDay(deps.db, account, '2026-01-01', extra)).toEqual({ date: '2026-01-05', balanceCents: -1000 });
  });

  it('looks only from the entry date on — an older dip is not this entry’s fault', async () => {
    const { deps, ctx } = setupFinance();
    const account = await cashAccount(deps, ctx, { openingBalanceCents: 0, openingDate: '2026-01-01' });
    // Ein alter Einbruch am 02.01. (Bestand −1,00 €), am 03.01. wieder ausgeglichen (+2,00 € → 1,00 €).
    bookLine(deps, account.id, '2026-01-02', -100);
    bookLine(deps, account.id, '2026-01-03', 200);
    expect(firstNegativeCashDay(deps.db, account, '2026-01-01', [])).toEqual({ date: '2026-01-02', balanceCents: -100 });
    // Ab dem 03.01. gefragt, zählt der alte Einbruch vom 02.01. nicht mehr.
    expect(firstNegativeCashDay(deps.db, account, '2026-01-03', [])).toBeNull();
  });

  it('counts several lines of one day together: the day end matters, not the order', async () => {
    const { deps, ctx } = setupFinance();
    const account = await cashAccount(deps, ctx, { openingBalanceCents: 10000, openingDate: '2026-01-01' });
    // −120,00 € und +50,00 € am selben Tag bei Bestand 100,00 €: Tagesende 30,00 € — gut, auch wenn die Abhebung zuerst gebucht wird.
    bookLine(deps, account.id, '2026-01-02', -12000);
    bookLine(deps, account.id, '2026-01-02', 5000);
    expect(firstNegativeCashDay(deps.db, account, '2026-01-01', [])).toBeNull();
  });

  it('ignores drafts and other accounts', async () => {
    const { deps, ctx } = setupFinance();
    const account = await cashAccount(deps, ctx, { openingBalanceCents: 10000, openingDate: '2026-01-01' });
    const other = await cashAccount(deps, ctx, { openingBalanceCents: 10000, openingDate: '2026-01-01' });
    bookLine(deps, account.id, '2026-01-02', -50000, 'draft');
    bookLine(deps, other.id, '2026-01-02', -50000, 'final');
    expect(firstNegativeCashDay(deps.db, account, '2026-01-01', [])).toBeNull();
  });

  it('treats an account without an opening balance as starting at zero', async () => {
    const { deps, ctx } = setupFinance();
    const account = await cashAccount(deps, ctx);
    bookLine(deps, account.id, '2026-01-02', -500);
    expect(firstNegativeCashDay(deps.db, account, '2026-01-01', [])).toEqual({ date: '2026-01-02', balanceCents: -500 });
  });

  it('formats cents as German euros', () => {
    expect(formatEuro(-1250)).toBe('-12,50 €');
    expect(formatEuro(123456)).toBe('1.234,56 €');
  });
});
