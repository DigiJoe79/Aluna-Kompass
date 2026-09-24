import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookFromTransaction, linkTransactionToEntry } from '../src/import/book';
import { listContactIbans } from '../src/import/contact-ibans';
import { createAccount } from '../src/ledger/accounts';
import { setCategoryActive } from '../src/ledger/categories';
import { getEntry, saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { financeEntries, financeMoneyLines } from '../src/schema';
import { allowHumanOnlyOverMcp, insertRaw, insertRun, ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const IBAN = 'DE66999999991234567890';
const auditOf = (f: Fixture) => f.deps.db.select().from(schema.auditLog).all();

async function openRaw(f: Fixture, o: { amountCents: number; purpose?: string; iban?: string | null; accountId?: string; date?: string } = { amountCents: -1990 }) {
  return insertRaw(f, insertRun(f, o.accountId ?? f.bank.id), { accountId: o.accountId ?? f.bank.id, amountCents: o.amountCents, purpose: o.purpose, iban: o.iban, date: o.date });
}

describe('bookFromTransaction', () => {
  it('books a reviewed draft from a transaction in one call and binds the transaction', async () => {
    const f = await ledgerFixture();
    const rawId = await openRaw(f, { amountCents: -1990, purpose: 'Büromaterial' });
    const entry = unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: rawId, text: 'Büromaterial', allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1990 }], reviewed: true }));
    expect(entry).toMatchObject({ status: 'draft', entryDate: '2026-03-05', text: 'Büromaterial', remainderCents: 0 });
    expect(entry.reviewedAt).not.toBeNull();
    expect(entry.moneyLines).toMatchObject([{ accountId: f.bank.id, amountCents: -1990, rawTransactionId: rawId }]);

    // Ohne `reviewed` bleibt es ein ungeprüfter Entwurf; das Datum ist wählbar.
    const other = await openRaw(f, { amountCents: -500 });
    const plain = unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: other, entryDate: '2026-03-06', text: 'Gebühr', allocationLines: [{ categoryId: f.fees.id, amountCents: -500 }], reviewed: false }));
    expect(plain).toMatchObject({ entryDate: '2026-03-06', reviewedAt: null });

    // Audit: Entwurf und Prüfung, nie der Text.
    const actions = auditOf(f).filter((e) => e.entityId === entry.id).map((e) => e.action);
    expect(actions).toEqual(['finance.entry.draftSave', 'finance.entry.review']);
    expect(JSON.stringify(auditOf(f))).not.toContain('Büromaterial');
  });

  it('refuses without finance.entriesWrite, with an invalid input, and for an unknown or discarded transaction', async () => {
    const f = await ledgerFixture();
    const rawId = await openRaw(f);
    const gone = insertRaw(f, insertRun(f, f.bank.id, { discarded: true }), { accountId: f.bank.id, amountCents: -100 });
    const input = { rawTransactionId: rawId, text: 'x', allocationLines: [], reviewed: false };
    expect(await bookFromTransaction(f.deps, ctxWith(['finance.read']), input)).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: rawId, text: '', allocationLines: [] })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await bookFromTransaction(f.deps, f.ctx, { ...input, rawTransactionId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await bookFromTransaction(f.deps, f.ctx, { ...input, rawTransactionId: gone })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'rawTransactionDiscarded' } });
  });

  it('refuses reviewed:true over mcp until the association allows it at the screen', async () => {
    const f = await ledgerFixture();
    const rawId = await openRaw(f);
    const agent = { ...f.ctx, channel: 'mcp' as const };
    const input = { rawTransactionId: rawId, text: 'Büromaterial', allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1990 }] };
    expect(await bookFromTransaction(f.deps, agent, { ...input, reviewed: true })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    expect(f.deps.db.select().from(financeEntries).all()).toHaveLength(0);

    // Vorlegen darf der Agent immer.
    const draft = unwrap(await bookFromTransaction(f.deps, agent, { ...input, reviewed: false }));
    expect(draft).toMatchObject({ createdChannel: 'mcp', reviewedAt: null });

    allowHumanOnlyOverMcp(f.deps);
    const other = await openRaw(f);
    expect((await bookFromTransaction(f.deps, agent, { ...input, rawTransactionId: other, reviewed: true })).ok).toBe(true);
  });

  it('learns the contact iban when a line carries a contact and the transaction an iban', async () => {
    const f = await ledgerFixture();
    const rawId = await openRaw(f, { amountCents: 2500, iban: IBAN });
    unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: rawId, text: 'Spende', allocationLines: [{ categoryId: f.donations.id, amountCents: 2500, contactId: f.donor.id }], reviewed: false }));
    expect(unwrap(await listContactIbans(f.deps, f.ctx, { contactId: f.donor.id })).items).toMatchObject([{ contactId: f.donor.id, iban: IBAN }]);
    const log = auditOf(f).filter((e) => e.entityType === 'financeContactBankAccount');
    expect(log.map((e) => [e.action, JSON.parse(e.after!)])).toEqual([['finance.contactIban.link', { learnedFrom: 'booking' }]]);

    // Ohne IBAN am Umsatz oder ohne Kontakt an der Zeile: nichts gelernt.
    const noIban = await openRaw(f, { amountCents: 1000, iban: null });
    unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: noIban, text: 'Spende', allocationLines: [{ categoryId: f.donations.id, amountCents: 1000, contactId: f.rightDonor.id }], reviewed: false }));
    expect(unwrap(await listContactIbans(f.deps, f.ctx, { contactId: f.rightDonor.id })).items).toEqual([]);
  });

  it('books a transfer with the paired transaction as second money line', async () => {
    const f = await ledgerFixture();
    const savings = unwrap(await createAccount(f.deps, f.ctx, { name: 'Rücklagenkonto', kind: 'bank', iban: 'DE75999999990000303062' }));
    const out = await openRaw(f, { amountCents: -10000, date: '2026-03-10' });
    const into = await openRaw(f, { accountId: savings.id, amountCents: 10000, date: '2026-03-11' });
    const entry = unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: out, text: 'Übertrag', allocationLines: [], extraMoneyLines: [{ accountId: savings.id, amountCents: 10000, rawTransactionId: into }], reviewed: true }));
    expect(entry.moneyLines).toMatchObject([{ accountId: f.bank.id, amountCents: -10000, rawTransactionId: out }, { accountId: savings.id, amountCents: 10000, rawTransactionId: into }]);
    expect(entry.remainderCents).toBe(0);
  });

  it('books a cash transfer suggestion in one go and refuses to park it as a draft', async () => {
    const f = await ledgerFixture();
    // Die Kasse hat vorher Geld — sonst ginge sie beim Festschreiben ins Minus.
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spendendose', moneyLines: [{ accountId: f.cash.id, amountCents: 20000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    const deposit = await openRaw(f, { amountCents: 20000, purpose: 'Bareinzahlung Spendendose', iban: null });
    const input = { rawTransactionId: deposit, text: 'Bareinzahlung', allocationLines: [], extraMoneyLines: [{ accountId: f.cash.id, amountCents: -20000 }] };

    expect(await bookFromTransaction(f.deps, f.ctx, { ...input, reviewed: false })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashDraftNotAllowed' } });
    // Festschreiben braucht sein eigenes Recht.
    expect(await bookFromTransaction(f.deps, ctxWith(['finance.read', 'finance.entriesWrite'], f.userId), { ...input, reviewed: true })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesFinalize' } });
    expect(f.deps.db.select().from(financeMoneyLines).where(eq(financeMoneyLines.rawTransactionId, deposit)).all()).toHaveLength(0);

    const entry = unwrap(await bookFromTransaction(f.deps, f.ctx, { ...input, reviewed: true }));
    expect(entry.status).toBe('final');
    expect(entry.number).not.toBeNull();
    expect(entry.moneyLines).toMatchObject([{ accountId: f.bank.id, amountCents: 20000, rawTransactionId: deposit }, { accountId: f.cash.id, amountCents: -20000 }]);
  });

  it('refuses to book from a suggestion whose category is inactive, naming the remedy', async () => {
    const f = await ledgerFixture();
    unwrap(await setCategoryActive(f.deps, f.ctx, { id: f.programCosts.id, isActive: false }));
    const rawId = await openRaw(f);
    const res = await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: rawId, text: 'Büromaterial', allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1990 }], reviewed: true });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'categoryInactive' } });
    if (!res.ok) expect((res.error as { message: string }).message).toMatch(/aktivieren Sie sie unter „Finanzen einrichten“/);
    expect(f.deps.db.select().from(financeEntries).all()).toHaveLength(0);
  });

  it('reports suggestionStale when the transaction got bound meanwhile', async () => {
    const f = await ledgerFixture();
    const rawId = await openRaw(f, { amountCents: 2500 });
    const input = { rawTransactionId: rawId, text: 'Spende', allocationLines: [{ categoryId: f.donations.id, amountCents: 2500 }], reviewed: false };
    // Die Arbeitsliste zeigte den Entwurf eines Agenten …
    const shown = unwrap(await bookFromTransaction(f.deps, { ...f.ctx, channel: 'mcp' }, input));
    // … und die Übernahme ersetzt genau diesen Entwurf, statt einen zweiten anzulegen.
    const replaced = unwrap(await bookFromTransaction(f.deps, f.ctx, { ...input, text: 'Spende April', reviewed: true, expectedDraftId: shown.id }));
    expect(replaced).toMatchObject({ id: shown.id, text: 'Spende April' });
    expect(f.deps.db.select().from(financeEntries).all()).toHaveLength(1);

    // Inzwischen hängt der Umsatz an einer anderen Buchung: Der Vorschlag gilt nicht mehr.
    expect(await bookFromTransaction(f.deps, f.ctx, { ...input, expectedDraftId: 'ein-anderer-entwurf' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'suggestionStale' } });
    // Ohne erwarteten Entwurf: Der Umsatz gehört schon zu einer Buchung.
    expect(await bookFromTransaction(f.deps, f.ctx, input)).toMatchObject({ ok: false, error: { type: 'conflict', code: 'transactionAlreadyBooked' } });

    // Auch der Gegen-Umsatz einer Umbuchung kann inzwischen vergeben sein.
    const savings = unwrap(await createAccount(f.deps, f.ctx, { name: 'Rücklagenkonto', kind: 'bank', iban: 'DE75999999990000303062' }));
    const out = await openRaw(f, { amountCents: -10000 });
    const into = await openRaw(f, { accountId: savings.id, amountCents: 10000 });
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Übertrag', moneyLines: [{ accountId: savings.id, amountCents: 10000, rawTransactionId: into }], allocationLines: [] }));
    expect(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: out, text: 'Übertrag', allocationLines: [], extraMoneyLines: [{ accountId: savings.id, amountCents: 10000, rawTransactionId: into }], reviewed: false })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'suggestionStale' } });
  });
});

describe('linkTransactionToEntry', () => {
  it('links a transaction to a finalized entry line from empty, once, and never to a taken line', async () => {
    const f = await ledgerFixture();
    const booked = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-04', text: 'Zuschuss', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));
    const first = await openRaw(f, { amountCents: 3000 });
    const second = await openRaw(f, { amountCents: 3000 });

    const linked = unwrap(await linkTransactionToEntry(f.deps, f.ctx, { rawTransactionId: first, entryId: booked.id }));
    expect(linked).toMatchObject({ id: booked.id, status: 'final', number: booked.number });
    expect(linked.moneyLines).toMatchObject([{ rawTransactionId: first }]);
    const log = auditOf(f).filter((e) => e.action === 'finance.entry.rawLink');
    expect(log.map((e) => [e.entityId, JSON.parse(e.after!)])).toEqual([[booked.id, { entryId: booked.id, linkCount: 1 }]]);

    // Die Zeile ist vergeben — ein zweiter Umsatz findet keine freie mehr.
    expect(await linkTransactionToEntry(f.deps, f.ctx, { rawTransactionId: second, entryId: booked.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'entryLineNotBindable' } });
    // Und der erste Umsatz ist nicht ein zweites Mal verknüpfbar.
    const other = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-04', text: 'Zuschuss', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));
    expect(await linkTransactionToEntry(f.deps, f.ctx, { rawTransactionId: first, entryId: other.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'transactionAlreadyBooked' } });
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: other.id })).moneyLines[0]!.rawTransactionId).toBeNull();
  });

  it('refuses linking when no line on that account with that amount is unbound', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Lastschrift', moneyLines: [{ accountId: f.bank.id, amountCents: -1200 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1200 }] }));
    const wrongAmount = await openRaw(f, { amountCents: -1300 });
    const savings = unwrap(await createAccount(f.deps, f.ctx, { name: 'Rücklagenkonto', kind: 'bank', iban: 'DE75999999990000303062' }));
    const wrongAccount = await openRaw(f, { accountId: savings.id, amountCents: -1200 });
    expect(await linkTransactionToEntry(f.deps, f.ctx, { rawTransactionId: wrongAmount, entryId: draft.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'entryLineNotBindable' } });
    expect(await linkTransactionToEntry(f.deps, f.ctx, { rawTransactionId: wrongAccount, entryId: draft.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'entryLineNotBindable' } });

    // Ein Entwurf lässt sich genauso verknüpfen.
    const fits = await openRaw(f, { amountCents: -1200 });
    expect(unwrap(await linkTransactionToEntry(f.deps, f.ctx, { rawTransactionId: fits, entryId: draft.id })).moneyLines).toMatchObject([{ rawTransactionId: fits }]);

    expect(await linkTransactionToEntry(f.deps, ctxWith(['finance.read']), { rawTransactionId: fits, entryId: draft.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await linkTransactionToEntry(f.deps, f.ctx, { rawTransactionId: fits })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await linkTransactionToEntry(f.deps, f.ctx, { rawTransactionId: wrongAmount, entryId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});
