import { newId, schema, unwrap } from '@kompass/core';
import { systemContext, TEST_NOW } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { getEntry, listEntries, saveDraft, type EntryView } from '../src/ledger/entries';
import { reverseEntry, reverseInternal } from '../src/ledger/reverse';
import { installFinance } from '../src/install';
import type { EntryLock } from '../src/locks';
import { financeCategories, financeMoneyLines, financePeriodEvents } from '../src/schema';
import { allowHumanOnlyOverMcp, ledgerFixture, setupFinance } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

async function draft(f: Awaited<ReturnType<typeof ledgerFixture>>, cents: number, entryDate = '2026-03-01'): Promise<EntryView> {
  return unwrap(await saveDraft(f.deps, f.ctx, { entryDate, text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents }] }));
}

describe('reverseEntry', () => {
  it('writes a counter entry with negated lines, links both ways, and releases the raw transaction', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 5000)).id }));
    f.deps.db.update(financeMoneyLines).set({ rawTransactionId: 'R1' }).where(eq(financeMoneyLines.entryId, entry.id)).run();

    const res = unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    expect(res.reversal).toMatchObject({ status: 'final', reversesEntryId: entry.id, text: `Storno ${res.reversal.number}` });
    expect(res.reversal.moneyLines[0]).toMatchObject({ accountId: f.bank.id, amountCents: -5000, rawTransactionId: null });
    expect(res.reversal.allocationLines[0]).toMatchObject({ categoryId: f.donations.id, amountCents: -5000 });

    const original = unwrap(await getEntry(f.deps, f.ctx, { id: entry.id }));
    expect(original.reversedByEntryId).toBe(res.reversal.id);
    expect(original.moneyLines[0]!.rawReleasedAt).not.toBeNull();
  });

  it('keeps the original date while its year is open', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 5000, '2026-03-05')).id }));
    const res = unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    expect(res.reversal.entryDate).toBe('2026-03-05');
    expect(res.reversal.number).toBe('2026-0002');
  });

  it('Prüfstein 7: in a closed year the reversal is dated today and numbered in the current year', async () => {
    const { deps, ctx, userId } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE02120300000000202051', isMain: true }));
    const donations = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'donations')).get()!;
    const year2025 = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2025-01-01', endsOn: '2025-12-31' }));

    const d = unwrap(await saveDraft(deps, ctx, { entryDate: '2025-06-01', text: 'Spende', moneyLines: [{ accountId: bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: donations.id, amountCents: 5000 }] }));
    const finalized = unwrap(await finalizeEntry(deps, ctx, { id: d.id }));
    expect(finalized.number).toBe('2025-0001');

    // Das Vorjahr wird abgeschlossen; deps.clock steht auf 2026 — dort ist noch kein Geschäftsjahr angelegt.
    deps.db.insert(financePeriodEvents).values({ id: newId(), fiscalYearId: year2025.id, kind: 'closed', at: '2025-12-31T00:00:00.000Z', byUserId: userId, reason: null }).run();

    const res = unwrap(await reverseEntry(deps, ctx, { id: finalized.id }));
    expect(res.reversal.entryDate).toBe(TEST_NOW.slice(0, 10));
    expect(res.reversal.number).toBe('2026-0001');
  });

  it('refuses a draft, a reversal, and a second reversal', async () => {
    const f = await ledgerFixture();
    const d = await draft(f, 5000);
    expect(err(await reverseEntry(f.deps, f.ctx, { id: d.id }))).toMatchObject({ type: 'conflict', code: 'entryNotFinal' });

    const entry = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 3000)).id }));
    const res = unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    expect(err(await reverseEntry(f.deps, f.ctx, { id: res.reversal.id }))).toMatchObject({ type: 'conflict', code: 'entryIsReversal' });
    expect(err(await reverseEntry(f.deps, f.ctx, { id: entry.id }))).toMatchObject({ type: 'conflict', code: 'entryAlreadyReversed' });
  });

  it('refuses when a lock says the entry is built upon — and says why', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 5000)).id }));
    const blockingLock: EntryLock = () => ({ scope: 'entry', reason: 'Ein Nachtrag verweist darauf.' });
    const result = f.deps.db.transaction((tx) => reverseInternal(tx, f.deps, f.ctx, { id: entry.id }, [blockingLock]));
    expect(result).toMatchObject({ ok: false, error: { type: 'conflict', code: 'entryLocked', message: expect.stringContaining('Ein Nachtrag verweist darauf.') } });
  });

  it('a reversal that would take the cash box below zero wants a reason, and keeps it on the entry', async () => {
    const f = await ledgerFixture();
    // Einzahlung 20,00 € am 01.03.; Bar-Ausgabe 15,00 € am 02.03. (Bestand danach 5,00 € — gut).
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Einzahlung', moneyLines: [{ accountId: f.cash.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.cash.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    // Ohne die Einzahlung wäre der 02.03. bei −15,00 €.
    expect(err(await reverseEntry(f.deps, f.ctx, { id: entry.id }))).toMatchObject({ type: 'conflict', code: 'cashNegativeNeedsReason' });
    const res = unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id, cashWarningReason: 'Fehlbuchung storniert, Bargeld bereits zurückgelegt.' }));
    expect(res.reversal.cashWarningReason).toBe('Fehlbuchung storniert, Bargeld bereits zurückgelegt.');
  });

  it('can leave a correction draft behind: same lines, pointing at the original, not reviewed, without the raw transaction', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 5000)).id }));
    const res = unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id, withCorrectionDraft: true }));
    expect(res.correctionDraft).toMatchObject({ status: 'draft', correctionOfEntryId: entry.id, reviewedAt: null });
    expect(res.correctionDraft!.moneyLines[0]).toMatchObject({ accountId: f.bank.id, amountCents: 5000, rawTransactionId: null });

    // Bargeld parkt nicht: Hat das Original eine Barzeile, entsteht kein Ersatz-Entwurf.
    const cashEntry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Einzahlung', moneyLines: [{ accountId: f.cash.id, amountCents: 500 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 500 }] }));
    const cashRes = unwrap(await reverseEntry(f.deps, f.ctx, { id: cashEntry.id, withCorrectionDraft: true }));
    expect(cashRes.correctionDraft).toBeNull();
  });

  it('is refused over MCP like every finalizing step', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 5000)).id }));
    const agent = { ...f.ctx, channel: 'mcp' as const };
    expect(err(await reverseEntry(f.deps, agent, { id: entry.id }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    allowHumanOnlyOverMcp(f.deps);
    expect((await reverseEntry(f.deps, agent, { id: entry.id })).ok).toBe(true);
  });

  it('reverses ⇔ reversedBy: the two pointers always agree', async () => {
    const f = await ledgerFixture();
    const e1 = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 1000, '2026-03-01')).id }));
    const e2 = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 2000, '2026-03-02')).id }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: e1.id }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: e2.id }));

    const all = unwrap(await listEntries(f.deps, f.ctx, {})).entries;
    for (const head of all) {
      if (head.reversesEntryId) expect(all.find((h) => h.id === head.reversesEntryId)!.reversedByEntryId).toBe(head.id);
      if (head.reversedByEntryId) expect(all.find((h) => h.id === head.reversedByEntryId)!.reversesEntryId).toBe(head.id);
    }
  });

  it('logs numbers only', async () => {
    const f = await ledgerFixture();
    const d = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende von Erika Beispiel', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, contactId: f.donor.id }] }));
    const entry = unwrap(await finalizeEntry(f.deps, f.ctx, { id: d.id }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.entry.')));
    expect(log).toContain('finance.entry.reverse');
    expect(log).not.toContain('Erika');
    expect(log).not.toContain(f.donor.id);
  });
});
