import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createAccount } from '../src/ledger/accounts';
import { createContact, deleteContact } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { countCash, emptyDonationBox, lastCountInternal, listCashCounts, moveCash } from '../src/ledger/cash';
import { financeRetentionHolds } from '../src/ledger/holds';
import { financeAllocationLines, financeCashCounts, financeEntries, financeMoneyLines } from '../src/schema';
import { allowHumanOnlyOverMcp, ledgerFixture } from './helpers';

/** Bringt die Kasse der Fixture auf einen Bestand von 214,50 € zum 2026-03-10. */
async function fixtureWithCashBalance() {
  const f = await ledgerFixture();
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Anfangsbestand Kasse', moneyLines: [{ accountId: f.cash.id, amountCents: 21450 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 21450 }] }));
  return f;
}

describe('countCash', () => {
  it('stores the count as a fact and issues the protocol when book and count agree; no entry arises', async () => {
    const f = await fixtureWithCashBalance();
    const res = unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    expect(res.entry).toBeNull();
    expect(res.documentNumber).toMatch(/^KZP-/);
    expect(res.count).toMatchObject({ accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, bookCents: 21450, differenceCents: 0, kind: 'equal', entryId: null });
    const row = f.deps.db.select().from(financeCashCounts).where(eq(financeCashCounts.id, res.count.id)).get()!;
    expect(row.documentNumber).toBe(res.documentNumber);
    expect(f.deps.db.select().from(financeEntries).all()).toHaveLength(1); // nur der Anfangsbestand, keine neue Buchung
  });

  it('books a shortage to cash-shortage, finalized, with the protocol as voucher', async () => {
    const f = await fixtureWithCashBalance();
    const res = unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21000, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id, note: 'Wechselgeld verauslagt' }));
    expect(res.count.kind).toBe('shortage');
    expect(res.count.differenceCents).toBe(-450);
    expect(res.entry).not.toBeNull();
    expect(res.entry!.status).toBe('final');
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, res.entry!.id)).get()!;
    expect(f.deps.db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, res.entry!.id)).get()!.amountCents).toBe(-450);
    expect(line.amountCents).toBe(-450);
    expect(res.entry!.vouchers).toHaveLength(1);
    expect(res.entry!.vouchers[0]!.documentNumber).toBe(res.documentNumber);
  });

  it('refuses a shortage without a note and names the remedy', async () => {
    const f = await fixtureWithCashBalance();
    const res = await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21000, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashCountNeedsNote' } });
    expect(f.deps.db.select().from(financeCashCounts).all()).toHaveLength(0);
  });

  it('books a surplus to cash-surplus without demanding a note', async () => {
    const f = await fixtureWithCashBalance();
    const res = unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 22000, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    expect(res.count.kind).toBe('surplus');
    expect(res.count.differenceCents).toBe(550);
    expect(res.entry).not.toBeNull();
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, res.entry!.id)).get()!;
    expect(line.amountCents).toBe(550);
  });

  it('demands two different counters, both existing contacts of kind person', async () => {
    const f = await fixtureWithCashBalance();
    const sameCounter = await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.donor.id });
    expect(sameCounter).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashCountSameCounter' } });

    const manage = ctxWith(['contacts.manage'], f.userId);
    const org = unwrap(await createContact(f.deps, manage, { kind: 'organization', name: 'Beispielverein' }));
    const orgCounter = await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: org.id });
    expect(orgCounter).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashCountCounterNotPerson' } });

    const missing = await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: 'nonexistent' });
    expect(missing).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });

  it('prints the counters’ display names into the protocol and keeps them on the count row', async () => {
    const f = await fixtureWithCashBalance();
    const res = unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    expect(res.count.counterOneName).toBe('Musterspenderin');
    expect(res.count.counterTwoName).toBe('Fehlspenderin');
    const doc = f.deps.db.select().from(documents).where(eq(documents.number, res.documentNumber)).get()!;
    expect(doc.inputSnapshot).toContain('Musterspenderin');
    expect(doc.inputSnapshot).toContain('Fehlspenderin');
  });

  it('holds both counters as contacts until the hold of the count’s fiscal year ends, and permanently in a year never closed', async () => {
    const f = await fixtureWithCashBalance();
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    const holds = financeRetentionHolds(f.deps, 'contact', f.donor.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]!.until).toBeNull(); // Jahr 2026 nie geschlossen
    expect(holds[0]!.entity).toBe('financeCashCount');

    f.closeYear(f.year.id);
    const closedHolds = financeRetentionHolds(f.deps, 'contact', f.donor.id);
    expect(closedHolds[0]!.until).toBe('2036-12-31');
  });

  it('lets a held counter not be deleted, and names finance as the holder', async () => {
    const f = await fixtureWithCashBalance();
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    const manage = ctxWith(['contacts.manage'], f.userId);
    const result = await deleteContact(f.deps, manage, { id: f.donor.id });
    expect(result.ok).toBe(false);
  });

  it('refuses a bank account and a future date', async () => {
    const f = await fixtureWithCashBalance();
    const bank = await countCash(f.deps, f.ctx, { accountId: f.bank.id, countedOn: '2026-03-10', countedCents: 100, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id });
    expect(bank).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashCountNotCash' } });

    const future = await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-12-31', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id });
    expect(future).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashCountInFuture' } });
  });

  it('rolls everything back when the entry cannot be finalized', async () => {
    const f = await fixtureWithCashBalance();
    f.closeYear(f.year.id);
    const before = f.deps.db.select().from(documents).all().length;
    const res = await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21000, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id, note: 'Fehlbetrag' });
    expect(res.ok).toBe(false);
    expect(f.deps.db.select().from(documents).all().length).toBe(before);
    expect(f.deps.db.select().from(financeCashCounts).all()).toHaveLength(0);
  });

  it('never writes counter names, contact ids or the note into the audit log', async () => {
    const f = await fixtureWithCashBalance();
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21000, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id, note: 'Geheimer Grund für den Fehlbetrag' }));
    // Nur, was Finanzen selbst schreibt — der Kontakt trägt seinen eigenen Namen zu Recht in seinem eigenen Anlege-Eintrag.
    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.'));
    const dump = JSON.stringify(log);
    expect(dump).not.toContain('Musterspenderin');
    expect(dump).not.toContain('Fehlspenderin');
    expect(dump).not.toContain(f.donor.id);
    expect(dump).not.toContain(f.wrongDonor.id);
    expect(dump).not.toContain('Geheimer Grund');
  });

  it('needs finance.entriesFinalize and a human', async () => {
    const f = await fixtureWithCashBalance();
    const writerOnly = ctxWith(['finance.entriesWrite', 'finance.read'], f.userId);
    const deniedRes = await countCash(f.deps, writerOnly, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id });
    expect(deniedRes).toMatchObject({ ok: false, error: { type: 'forbidden' } });

    const agent = { ...f.ctx, channel: 'mcp' as const };
    const agentRes = await countCash(f.deps, agent, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id });
    expect(agentRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

    allowHumanOnlyOverMcp(f.deps);
    const allowedRes = unwrap(await countCash(f.deps, agent, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    expect(allowedRes.count.kind).toBe('equal');
  });

  it('keeps a count row immutable and undeletable at database level', async () => {
    const f = await fixtureWithCashBalance();
    const res = unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    expect(() => f.deps.sqlite.prepare('update finance_cash_counts set counted_cents = 1 where id = ?').run(res.count.id)).toThrow();
    expect(() => f.deps.sqlite.prepare('delete from finance_cash_counts where id = ?').run(res.count.id)).toThrow();
  });
});

describe('emptyDonationBox', () => {
  it('books an emptied donation box as income without contact and issues its protocol', async () => {
    const f = await fixtureWithCashBalance();
    const res = unwrap(await emptyDonationBox(f.deps, f.ctx, { accountId: f.cash.id, date: '2026-03-10', amountCents: 3500, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id, boxLabel: 'Sammeldose Empfang' }));
    expect(res.documentNumber).toMatch(/^KZP-/);
    expect(res.entry.status).toBe('final');
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, res.entry.id)).get()!;
    expect(line.contactId).toBeNull();
    expect(line.amountCents).toBe(3500);
    expect(f.deps.db.select().from(financeCashCounts).all()).toHaveLength(0); // keine Zählungstabelle, nur die Buchung
  });
});

describe('moveCash', () => {
  it('moves cash between a bank account and a cash box as a transfer, finalized at once', async () => {
    const f = await fixtureWithCashBalance();
    const entry = unwrap(await moveCash(f.deps, f.ctx, { fromAccountId: f.bank.id, toAccountId: f.cash.id, date: '2026-03-10', amountCents: 5000 }));
    expect(entry.status).toBe('final');
    const lines = f.deps.db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entry.id)).all();
    expect(lines.find((l) => l.accountId === f.bank.id)!.amountCents).toBe(-5000);
    expect(lines.find((l) => l.accountId === f.cash.id)!.amountCents).toBe(5000);
  });

  it('refuses a move between two bank accounts here', async () => {
    const f = await fixtureWithCashBalance();
    const secondBank = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zweitkonto', kind: 'bank', iban: 'AT611904300234573201' }));
    const res = await moveCash(f.deps, f.ctx, { fromAccountId: f.bank.id, toAccountId: secondBank.id, date: '2026-03-10', amountCents: 100 });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashMoveNeedsOneCash' } });
  });
});

describe('listCashCounts and lastCountInternal', () => {
  it('reports the last count of a cash account in getBalances, and null for a bank account', async () => {
    const f = await fixtureWithCashBalance();
    expect(lastCountInternal(f.deps.db, f.cash.id)).toBeNull();
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    expect(lastCountInternal(f.deps.db, f.cash.id)).toEqual({ countedOn: '2026-03-10', countedCents: 21450 });
    expect(lastCountInternal(f.deps.db, f.bank.id)).toBeNull();
  });

  it('lists stored counts, newest first, filterable by account', async () => {
    const f = await fixtureWithCashBalance();
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-05', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 21450, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    const { counts, total } = unwrap(await listCashCounts(f.deps, f.ctx, { accountId: f.cash.id }));
    expect(total).toBe(2);
    expect(counts[0]!.countedOn).toBe('2026-03-10');
    expect(counts[1]!.countedOn).toBe('2026-03-05');
  });
});
