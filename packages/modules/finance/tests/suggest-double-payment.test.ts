import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createOpenItem } from '../src/ledger/open-items';
import { financeOpenItems } from '../src/schema';
import { creditScene, suggest } from './direct-debit-credit-fixture';
import { insertRaw, insertRun } from './helpers';

// Plan N1 Task 2 (E4; M16, M17): Vorschläge, die eine Doppelzahlung verbergen würden. Uhr: 20.10.2026.

describe('a transfer on an item that is in a submitted collection (M17)', () => {
  it('names the collection day as problem and is never sure', async () => {
    const f = await creditScene();
    const statement = insertRun(f, f.bank.id);
    const raw = insertRaw(f, statement, { accountId: f.bank.id, amountCents: 5000, date: '2026-10-21', purpose: 'Beitrag 2026 Mitglied 0001', name: 'Erika Beispiel', iban: 'DE02999999990000111111' });
    const s = await suggest(f, raw);
    expect(s).toMatchObject({ kind: 'openItem', confidence: 'unsure', problems: ['inSubmittedRun'], problemParams: { inSubmittedRun: { date: '2026-10-30' } } });
    expect(s.draft!.moneyLines[0]!.settlements).toEqual([{ openItemId: f.feeId, amountCents: 5000 }]);
  });
});

describe('a payment over the open amount (E4, M16)', () => {
  it('settles the open amount; the rest is its own line without category, with the problem overpaid and the amount', async () => {
    const f = await creditScene();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-10-01', contactId: f.a.contactId, amountCents: 1200, dueOn: '2026-10-15', paymentReference: 'Beitrag 2026 Mitglied 0005' }));
    f.deps.db.update(financeOpenItems).set({ lineTemplate: JSON.stringify([{ categoryId: f.membership, contactId: f.a.contactId }]) }).where(eq(financeOpenItems.id, item.id)).run();
    const statement = insertRun(f, f.bank.id);
    const raw = insertRaw(f, statement, { accountId: f.bank.id, amountCents: 1500, date: '2026-10-16', purpose: 'Beitrag 2026 Mitglied 0005', name: 'Erika Beispiel', iban: 'DE02999999990000111111' });
    const s = await suggest(f, raw);
    expect(s).toMatchObject({ kind: 'openItem', confidence: 'unsure', problems: ['overpaid'], problemParams: { overpaid: { amountCents: 300 } } });
    expect(s.draft!.moneyLines[0]!.settlements).toEqual([{ openItemId: item.id, amountCents: 1200 }]);
    expect(s.draft!.allocationLines).toEqual([
      { categoryId: f.membership, amountCents: 1200, contactId: f.a.contactId },
      { categoryId: '', amountCents: 300, contactId: f.a.contactId },
    ]);
  });

  it('exactly the open amount: no rest line, no problem', async () => {
    const f = await creditScene();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-10-01', contactId: f.a.contactId, amountCents: 1200, dueOn: '2026-10-15', paymentReference: 'Beitrag 2026 Mitglied 0005' }));
    f.deps.db.update(financeOpenItems).set({ lineTemplate: JSON.stringify([{ categoryId: f.membership, contactId: f.a.contactId }]) }).where(eq(financeOpenItems.id, item.id)).run();
    const statement = insertRun(f, f.bank.id);
    const raw = insertRaw(f, statement, { accountId: f.bank.id, amountCents: 1200, date: '2026-10-16', purpose: 'Beitrag 2026 Mitglied 0005', name: 'Erika Beispiel', iban: 'DE02999999990000111111' });
    const s = await suggest(f, raw);
    expect(s).toMatchObject({ kind: 'openItem', confidence: 'sure', problems: [], problemParams: {} });
    expect(s.draft!.allocationLines).toHaveLength(1);
  });
});
