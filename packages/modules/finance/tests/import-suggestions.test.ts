import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact, setContactChannels } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { linkContactIban } from '../src/import/contact-ibans';
import { saveImportRule } from '../src/import/rules';
import { suggestForTransaction } from '../src/import/suggestions';
import { createAccount } from '../src/ledger/accounts';
import { moveCash } from '../src/ledger/cash';
import { setCategoryActive } from '../src/ledger/categories';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { createOpenItem } from '../src/ledger/open-items';
import { reverseEntry } from '../src/ledger/reverse';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const IBAN = 'DE66999999991234567890';
const suggest = async (f: Fixture, rawTransactionId: string) => unwrap(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId }));

function setSetting(f: Fixture, key: string, value: unknown): void {
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value));
}

describe('suggestForTransaction — (0) an existing entry', () => {
  it('suggests linking to a hand-booked entry on the same account with the same amount within the window', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-03', text: 'Bürobedarf bar vorgestreckt', moneyLines: [{ accountId: f.bank.id, amountCents: -1200 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1200 }] }));
    const final = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-04', text: 'Zuschuss', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));

    const toDraft = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1200, date: '2026-03-05', iban: null });
    expect(await suggest(f, toDraft)).toMatchObject({
      rawTransactionId: toDraft, kind: 'linkEntry', confidence: 'sure', draft: null,
      linkEntry: { entryId: draft.id, number: null, entryDate: '2026-03-03', status: 'draft' },
      reasons: [{ kind: 'linkEntry', entryId: draft.id, entryNumber: null }],
    });

    // Auch an einer festgeschriebenen Geldzeile (Spec 5.2).
    const toFinal = insertRaw(f, run, { accountId: f.bank.id, amountCents: 3000, date: '2026-03-09', iban: null });
    expect((await suggest(f, toFinal)).linkEntry).toMatchObject({ entryId: final.id, number: final.number, status: 'final' });

    // Außerhalb des Fensters (Vorgabe 5 Tage), mit anderem Betrag oder auf einem anderen Konto: nichts.
    const late = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1200, date: '2026-03-09', iban: null });
    const other = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1300, date: '2026-03-03', iban: null });
    expect((await suggest(f, late)).kind).not.toBe('linkEntry');
    expect((await suggest(f, other)).kind).not.toBe('linkEntry');
    setSetting(f, 'finance.matchEntryDays', 6);
    expect((await suggest(f, late)).kind).not.toBe('linkEntry'); // der erste Umsatz hat die Zeile schon für sich
  });

  it('never suggests a reversed entry or its reversal', async () => {
    const f = await ledgerFixture();
    const booked = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-04', text: 'Zuschuss', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: booked.id }));
    const rawIn = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 3000, date: '2026-03-05', iban: null });
    const rawOut = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -3000, date: '2026-03-05', iban: null });
    expect((await suggest(f, rawIn)).kind).not.toBe('linkEntry');
    expect((await suggest(f, rawOut)).kind).not.toBe('linkEntry');
  });

  it('offers no suggestion for a raw transaction bound to a replacement draft (Befund 16)', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const raw = insertRaw(f, run, { accountId: f.bank.id, amountCents: 5000 });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000, rawTransactionId: raw }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id, withCorrectionDraft: true }));
    // Bound geblieben durch den Ersatz-Entwurf — der Vorschlag ist veraltet, nicht neu berechnet.
    expect(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId: raw })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'suggestionStale' } });
  });

  it('suggests linking only while the entry line is still unbound', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const hand = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Lastschrift', moneyLines: [{ accountId: f.bank.id, amountCents: -1200 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1200 }] }));
    const first = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1200, iban: null, lineIndex: 1 });
    const second = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1200, iban: null, lineIndex: 2 });

    expect(await suggest(f, first)).toMatchObject({ kind: 'linkEntry', linkEntry: { entryId: hand.id } });
    const before = await suggest(f, second);
    expect(before.kind).not.toBe('linkEntry');
    expect(before.linkEntry).toBeNull();

    // Verknüpft: Der erste ist vergeben, der zweite bekommt nie dieselbe Buchung.
    unwrap(await saveDraft(f.deps, f.ctx, { id: hand.id, entryDate: '2026-03-05', text: 'Lastschrift', moneyLines: [{ accountId: f.bank.id, amountCents: -1200, rawTransactionId: first }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1200 }] }));
    const after = await suggest(f, second);
    expect(after.kind).not.toBe('linkEntry');
    expect(after.linkEntry).toBeNull();
    expect(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId: first })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'suggestionStale' } });
  });
});

describe('suggestForTransaction — (1) transfers between own accounts', () => {
  it('pairs a bank withdrawal with the deposit on another own account and proposes a transfer', async () => {
    const f = await ledgerFixture();
    const savings = unwrap(await createAccount(f.deps, f.ctx, { name: 'Rücklagenkonto', kind: 'bank', iban: 'DE75999999990000303062' }));
    const out = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -10000, date: '2026-03-10', purpose: 'Übertrag Rücklage' });
    const into = insertRaw(f, insertRun(f, savings.id), { accountId: savings.id, amountCents: 10000, date: '2026-03-11', purpose: 'Übertrag Rücklage' });
    expect(await suggest(f, out)).toMatchObject({
      kind: 'transfer', confidence: 'sure', linkEntry: null, problems: [],
      reasons: [{ kind: 'pair', otherAccountId: savings.id, otherRawTransactionId: into }],
      draft: {
        entryDate: '2026-03-10',
        moneyLines: [{ accountId: f.bank.id, amountCents: -10000, rawTransactionId: out }, { accountId: savings.id, amountCents: 10000, rawTransactionId: into }],
        allocationLines: [],
      },
    });
    // Von der anderen Seite derselbe Vorschlag.
    expect((await suggest(f, into)).reasons).toEqual([{ kind: 'pair', otherAccountId: f.bank.id, otherRawTransactionId: out }]);
  });

  it('pairs a payout with the bank receipt within fee tolerance and adds the fee line', async () => {
    const f = await ledgerFixture();
    const service = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zahlungsdienst', kind: 'paymentService' }));
    const payout = insertRaw(f, insertRun(f, service.id), { accountId: service.id, amountCents: -50000, date: '2026-03-10', purpose: 'Auszahlung' });
    const receipt = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 48500, date: '2026-03-12', purpose: 'Auszahlung Zahlungsdienst' });

    // 15 € Differenz liegen über der Vorgabe von 5 € — kein Paar.
    expect((await suggest(f, receipt)).kind).not.toBe('transfer');

    setSetting(f, 'finance.pairFeeToleranceCents', 1500);
    expect(await suggest(f, receipt)).toMatchObject({
      kind: 'transfer', confidence: 'sure',
      reasons: [{ kind: 'pair', otherAccountId: service.id, otherRawTransactionId: payout }],
      draft: {
        moneyLines: [{ accountId: f.bank.id, amountCents: 48500, rawTransactionId: receipt }, { accountId: service.id, amountCents: -50000, rawTransactionId: payout }],
        allocationLines: [{ categoryId: f.fees.id, amountCents: -1500 }],
      },
    });
    // Und das Paarfenster ist eine Einstellung.
    setSetting(f, 'finance.pairMatchDays', 1);
    expect((await suggest(f, receipt)).kind).not.toBe('transfer');
  });

  it('proposes a transfer against the cash account when the purpose carries a cash keyword', async () => {
    const f = await ledgerFixture();
    const deposit = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 20000, purpose: 'BAREINZAHLUNG Spendendose', name: null, iban: null });
    expect(await suggest(f, deposit)).toMatchObject({
      kind: 'cashTransfer', confidence: 'sure',
      reasons: [{ kind: 'cashKeyword', otherAccountId: f.cash.id }],
      draft: { moneyLines: [{ accountId: f.bank.id, amountCents: 20000, rawTransactionId: deposit }, { accountId: f.cash.id, amountCents: -20000 }], allocationLines: [] },
    });
    setSetting(f, 'finance.cashKeywords', ['Geldautomat']);
    expect((await suggest(f, deposit)).kind).not.toBe('cashTransfer');
  });

  it('links a cash-keyword transaction to an unlinked cash transfer entry within 30 days instead of proposing a new one (Befund 29)', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Anfangsbestand Kasse', moneyLines: [{ accountId: f.cash.id, amountCents: 50000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 50000 }] }));
    const entry = unwrap(await moveCash(f.deps, f.ctx, { fromAccountId: f.cash.id, toAccountId: f.bank.id, date: '2026-08-20', amountCents: 20000 }));
    const deposit = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 20000, date: '2026-08-29', purpose: 'BAREINZAHLUNG Spendendose', name: null, iban: null });
    expect(await suggest(f, deposit)).toMatchObject({
      kind: 'linkEntry', confidence: 'sure', draft: null,
      linkEntry: { entryId: entry.id, number: entry.number, entryDate: '2026-08-20', status: 'final' },
      reasons: [{ kind: 'cashTransferEntry', entryId: entry.id, entryNumber: entry.number }],
    });
  });

  it('still proposes a new cash transfer when no such entry exists (Befund 29)', async () => {
    const f = await ledgerFixture();
    const deposit = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 20000, date: '2026-08-29', purpose: 'BAREINZAHLUNG Spendendose', name: null, iban: null });
    expect(await suggest(f, deposit)).toMatchObject({ kind: 'cashTransfer', reasons: [{ kind: 'cashKeyword', otherAccountId: f.cash.id }] });
  });

  it('respects the 30-day window for the cash transfer entry — everything else unaffected (Befund 29)', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Anfangsbestand Kasse', moneyLines: [{ accountId: f.cash.id, amountCents: 50000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 50000 }] }));

    // Zu weit entfernt (31 Tage) — bleibt eine neue Umbuchung.
    unwrap(await moveCash(f.deps, f.ctx, { fromAccountId: f.cash.id, toAccountId: f.bank.id, date: '2026-07-01', amountCents: 5000 }));
    const depositFar = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 5000, date: '2026-08-01', purpose: 'BAREINZAHLUNG', name: null, iban: null });
    expect(await suggest(f, depositFar)).toMatchObject({ kind: 'cashTransfer' });

    // (0) bleibt unverändert an sein eigenes, engeres Fenster (`matchEntryDays`) gebunden.
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-03', text: 'Bürobedarf', moneyLines: [{ accountId: f.bank.id, amountCents: -1200 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1200 }] }));
    const late = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1200, date: '2026-03-09', iban: null });
    expect((await suggest(f, late)).kind).not.toBe('linkEntry');
  });
});

describe('suggestForTransaction — (2) returned payments', () => {
  it('proposes a returned payment with originLineId when the return code is set', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, date: '2026-02-01', purpose: 'Lastschrift Spende' });
    const origin = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 2500, rawTransactionId: incoming }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2500, contactId: f.donor.id }] }));
    const returned = insertRaw(f, run, { accountId: f.bank.id, amountCents: -2500, date: '2026-02-10', purpose: 'Rückgabe', returnCode: 'AC04' });
    expect(await suggest(f, returned)).toMatchObject({
      kind: 'return', confidence: 'sure',
      reasons: [{ kind: 'returnCode', entryId: origin.id, entryNumber: origin.number }],
      draft: {
        moneyLines: [{ accountId: f.bank.id, amountCents: -2500, rawTransactionId: returned }],
        allocationLines: [{ categoryId: f.donations.id, amountCents: -2500, contactId: f.donor.id, originLineId: origin.allocationLines[0]!.id }],
      },
    });
    const noCode = insertRaw(f, run, { accountId: f.bank.id, amountCents: -2500, date: '2026-02-11', purpose: 'Rückgabe' });
    expect((await suggest(f, noCode)).kind).not.toBe('return');
  });

  it('finds a possible return origin by return code, negated amount and name when the iban is missing (Befund 30a)', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, date: '2026-02-01', purpose: 'Lastschrift Spende', name: 'Erika Beispiel' });
    const origin = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 2500, rawTransactionId: incoming }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2500, contactId: f.donor.id }] }));
    const returned = insertRaw(f, run, { accountId: f.bank.id, amountCents: -2500, date: '2026-02-10', purpose: 'Rückgabe', returnCode: 'AC04', name: 'Erika Beispiel', iban: null });
    expect(await suggest(f, returned)).toMatchObject({
      kind: 'return', confidence: 'possible',
      reasons: [{ kind: 'returnCode', entryId: origin.id, entryNumber: origin.number }],
      draft: {
        moneyLines: [{ accountId: f.bank.id, amountCents: -2500, rawTransactionId: returned }],
        allocationLines: [{ categoryId: f.donations.id, amountCents: -2500, contactId: f.donor.id, originLineId: origin.allocationLines[0]!.id }],
      },
    });

    // Ohne einen einzigen Treffer bleibt es wie bisher — kein Rückläufer.
    const noMatch = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1900, date: '2026-02-10', purpose: 'Rückgabe', returnCode: 'AC04', name: 'Erika Beispiel', iban: null });
    expect((await suggest(f, noMatch)).kind).not.toBe('return');
  });

  it('lists several candidates instead of guessing when more than one name matches (Befund 30a)', async () => {
    const f = await ledgerFixture();
    const runA = insertRun(f, f.bank.id);
    const incomingA = insertRaw(f, runA, { accountId: f.bank.id, amountCents: 3000, date: '2026-01-10', purpose: 'Spende', name: 'Frank Muster' });
    const originA = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-01-10', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 3000, rawTransactionId: incomingA }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));
    const runB = insertRun(f, f.bank.id);
    const incomingB = insertRaw(f, runB, { accountId: f.bank.id, amountCents: 3000, date: '2026-02-05', purpose: 'Spende erneut', name: 'Frank Muster' });
    const originB = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-05', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 3000, rawTransactionId: incomingB }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));

    const returned = insertRaw(f, runB, { accountId: f.bank.id, amountCents: -3000, date: '2026-02-20', purpose: 'Rückgabe', returnCode: 'AC04', name: 'Frank Muster', iban: null });
    expect(await suggest(f, returned)).toMatchObject({
      kind: 'return', confidence: 'possible', draft: null,
      reasons: [{ kind: 'returnCode', returnCandidates: [{ entryId: originB.id, entryNumber: originB.number }, { entryId: originA.id, entryNumber: originA.number }] }],
    });
  });

  it('never treats a possible return as certain, even with exactly one match (Befund 30a)', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 1200, date: '2026-03-01', purpose: 'Spende', name: 'Uwe Beispielkontakt', iban: null });
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1200, rawTransactionId: incoming }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1200 }] }));
    const returned = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1200, date: '2026-03-05', purpose: 'Rückgabe', returnCode: 'AC04', name: 'Uwe Beispielkontakt', iban: null });
    const result = await suggest(f, returned);
    expect(result.kind).toBe('return');
    expect(result.confidence).not.toBe('sure');
    expect(result.confidence).toBe('possible');
  });
});

describe('suggestForTransaction — (2) refunds by the related transaction code (AC)', () => {
  const payPal = async (f: Fixture) => unwrap(await createAccount(f.deps, f.ctx, { name: 'Zahlungsdienst', kind: 'paymentService' }));

  it('proposes a partial refund of a booked donation as a sure return with originLineId on the donation line', async () => {
    const f = await ledgerFixture();
    const account = await payPal(f);
    const run = insertRun(f, account.id);
    const gift = insertRaw(f, run, { accountId: account.id, amountCents: 20000, date: '2026-03-05', iban: null, bankReference: 'TX1' });
    const fee = insertRaw(f, run, { accountId: account.id, amountCents: -350, date: '2026-03-05', iban: null, bankReference: 'TX1:fee', lineIndex: 2 });
    const origin = unwrap(await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-03-05', text: 'Spende über den Zahlungsdienst',
      moneyLines: [{ accountId: account.id, amountCents: 20000, rawTransactionId: gift }, { accountId: account.id, amountCents: -350, rawTransactionId: fee }],
      allocationLines: [{ categoryId: f.donations.id, amountCents: 20000, contactId: f.donor.id }, { categoryId: f.fees.id, amountCents: -350 }],
    }));
    const donationLine = origin.allocationLines.find((l) => l.amountCents > 0)!;
    const refund = insertRaw(f, run, { accountId: account.id, amountCents: -5000, date: '2026-03-12', iban: null, purpose: 'Rückzahlung', bankReference: 'TX9', relatedReference: 'TX1', lineIndex: 3 });
    expect(await suggest(f, refund)).toMatchObject({
      kind: 'return', confidence: 'sure',
      reasons: [{ kind: 'relatedReference', entryId: origin.id, entryNumber: origin.number }],
      draft: {
        moneyLines: [{ accountId: account.id, amountCents: -5000, rawTransactionId: refund }],
        allocationLines: [{ categoryId: f.donations.id, amountCents: -5000, contactId: f.donor.id, originLineId: donationLine.id }],
      },
    });
  });

  it('does not take a refund higher than the donation for a return, and says nothing for an unknown code', async () => {
    const f = await ledgerFixture();
    const account = await payPal(f);
    const run = insertRun(f, account.id);
    const gift = insertRaw(f, run, { accountId: account.id, amountCents: 2000, date: '2026-03-05', iban: null, bankReference: 'TX1' });
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Spende', moneyLines: [{ accountId: account.id, amountCents: 2000, rawTransactionId: gift }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000, contactId: f.donor.id }] }));
    const tooHigh = insertRaw(f, run, { accountId: account.id, amountCents: -5000, date: '2026-03-12', iban: null, bankReference: 'TX9', relatedReference: 'TX1', lineIndex: 2 });
    expect((await suggest(f, tooHigh)).kind).not.toBe('return');
    const unknown = insertRaw(f, run, { accountId: account.id, amountCents: -1000, date: '2026-03-12', iban: null, bankReference: 'TX10', relatedReference: 'TX-UNBEKANNT', lineIndex: 3 });
    expect((await suggest(f, unknown)).kind).not.toBe('return');
  });

  it('proposes the refund of a donation still in draft as unsure, without binding originLineId', async () => {
    const f = await ledgerFixture();
    const account = await payPal(f);
    const run = insertRun(f, account.id);
    const gift = insertRaw(f, run, { accountId: account.id, amountCents: 20000, date: '2026-03-05', iban: null, bankReference: 'TX1' });
    const origin = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Spende', moneyLines: [{ accountId: account.id, amountCents: 20000, rawTransactionId: gift }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000, contactId: f.donor.id }] }));
    const refund = insertRaw(f, run, { accountId: account.id, amountCents: -5000, date: '2026-03-12', iban: null, bankReference: 'TX9', relatedReference: 'TX1', lineIndex: 2 });
    const result = await suggest(f, refund);
    expect(result).toMatchObject({ kind: 'return', confidence: 'unsure', hints: ['originIsDraft'], reasons: [{ kind: 'relatedReference', entryId: origin.id }] });
    expect(result.draft!.allocationLines[0]!.originLineId ?? null).toBeNull();
  });
});

describe('suggestForTransaction — payment-service fees and donations without iban (AB)', () => {
  const service = async (f: Fixture) => unwrap(await createAccount(f.deps, f.ctx, { name: 'Zahlungsdienst', kind: 'paymentService' }));
  const manage = { ...systemContext(), permissions: new Set(['contacts.manage']) };

  it('proposes the fee line of a payment service as a sure payment-fee expense, found by the category key', async () => {
    const f = await ledgerFixture();
    const account = await service(f);
    const run = insertRun(f, account.id);
    const fee = insertRaw(f, run, { accountId: account.id, amountCents: -160, iban: null, purpose: 'Gebühr: Spende', bankReference: 'TX1:fee' });
    expect(await suggest(f, fee)).toMatchObject({
      kind: 'fee', confidence: 'sure', reasons: [{ kind: 'paymentFee' }],
      draft: { moneyLines: [{ accountId: account.id, amountCents: -160, rawTransactionId: fee }], allocationLines: [{ categoryId: f.fees.id, amountCents: -160 }] },
    });
    // Ein zurückerstatteter Gebührenanteil geht auf dieselbe Kategorie.
    const refundedFee = insertRaw(f, run, { accountId: account.id, amountCents: 160, iban: null, purpose: 'Gebühr: Rückzahlung', bankReference: 'TX9:fee', lineIndex: 2 });
    expect(await suggest(f, refundedFee)).toMatchObject({ kind: 'fee', draft: { allocationLines: [{ categoryId: f.fees.id, amountCents: 160 }] } });
  });

  it('finds the contact of an incoming line without iban by e-mail (sure) or by a unique name (unsure)', async () => {
    const f = await ledgerFixture();
    const account = await service(f);
    const erika = unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }));
    unwrap(await setContactChannels(f.deps, manage, { id: erika.id, channels: [{ kind: 'email', value: 'Erika@Beispiel.example', isPrimary: true }] }));
    const run = insertRun(f, account.id);
    const byMail = insertRaw(f, run, { accountId: account.id, amountCents: 5000, iban: null, name: 'E. Beispiel', email: 'erika@beispiel.example' });
    expect(await suggest(f, byMail)).toMatchObject({
      kind: 'contact', confidence: 'sure', reasons: [{ kind: 'contactEmail', contactId: erika.id }],
      draft: { allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, contactId: erika.id }] },
    });
    const byName = insertRaw(f, run, { accountId: account.id, amountCents: 2000, iban: null, name: ' erika  BEISPIEL ', lineIndex: 2 });
    expect(await suggest(f, byName)).toMatchObject({ kind: 'contact', confidence: 'unsure', reasons: [{ kind: 'contactName', contactId: erika.id }] });
  });

  it('proposes no contact for an ambiguous name, an unknown mail or an outgoing line', async () => {
    const f = await ledgerFixture();
    const account = await service(f);
    unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: 'Max', lastName: 'Muster' }));
    unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: 'Max', lastName: 'Muster' }));
    const run = insertRun(f, account.id);
    const twice = insertRaw(f, run, { accountId: account.id, amountCents: 2000, iban: null, name: 'Max Muster' });
    expect((await suggest(f, twice)).kind).toBe('none');
    const unknownMail = insertRaw(f, run, { accountId: account.id, amountCents: 2000, iban: null, name: 'Niemand Bekannt', email: 'niemand@beispiel.example', lineIndex: 2 });
    expect((await suggest(f, unknownMail)).kind).toBe('none');
    unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: 'Paula', lastName: 'Probe' }));
    const outgoing = insertRaw(f, run, { accountId: account.id, amountCents: -2000, iban: null, name: 'Paula Probe', lineIndex: 3 });
    expect((await suggest(f, outgoing)).kind).toBe('none');
  });
});

describe('suggestForTransaction — (3) open items', () => {
  it('settles an open item found by its payment reference as sure, and by amount and contact as unsure', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const invoice = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-20', amountCents: 23800, paymentReference: 'RE-4711', lineTemplate: [{ categoryId: f.programCosts.id, amountCents: -23800 }] }));
    const paid = insertRaw(f, run, { accountId: f.bank.id, amountCents: -23800, purpose: 'Rechnung RE-4711 vom Februar', iban: null });
    expect(await suggest(f, paid)).toMatchObject({
      kind: 'openItem', confidence: 'sure',
      reasons: [{ kind: 'paymentReference', openItemId: invoice.id, paymentReference: 'RE-4711' }],
      draft: {
        moneyLines: [{ accountId: f.bank.id, amountCents: -23800, rawTransactionId: paid, settlements: [{ openItemId: invoice.id, amountCents: 23800 }] }],
        allocationLines: [{ categoryId: f.programCosts.id, amountCents: -23800 }],
      },
    });

    const fee = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-02-01', amountCents: 5000, contactId: f.donor.id }));
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 5000, purpose: 'Beitrag' });
    expect(await suggest(f, incoming)).toMatchObject({
      kind: 'openItem', confidence: 'unsure',
      reasons: [{ kind: 'amountAndContact', openItemId: fee.id, contactId: f.donor.id }],
      draft: { moneyLines: [{ accountId: f.bank.id, amountCents: 5000, rawTransactionId: incoming, settlements: [{ openItemId: fee.id, amountCents: 5000 }] }] },
    });
    // Eine Forderung wird nie durch eine Ausgabe beglichen.
    const outgoing = insertRaw(f, run, { accountId: f.bank.id, amountCents: -5000, purpose: 'Beitrag' });
    expect((await suggest(f, outgoing)).kind).not.toBe('openItem');
  });

  it('names both open items instead of a sure pick when two share the payment reference (Befund Z)', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const first = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-20', amountCents: 17850, paymentReference: 'RE-4711' }));
    const second = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-21', amountCents: 17850, paymentReference: 'RE-4711' }));
    const paid = insertRaw(f, run, { accountId: f.bank.id, amountCents: -17850, purpose: 'Rechnung RE-4711 vom Februar', iban: null });
    const suggestion = await suggest(f, paid);
    expect(suggestion).toMatchObject({
      kind: 'openItem', confidence: 'possible', draft: null,
      reasons: [{ kind: 'paymentReference', paymentReference: 'RE-4711', openItemCandidates: [{ openItemId: first.id, itemDate: '2026-02-20', openCents: 17850 }, { openItemId: second.id, itemDate: '2026-02-21', openCents: 17850 }] }],
    });
    expect(suggestion.reasons[0]!.openItemId).toBeUndefined();
  });

  it('does not propose an open item that a draft already settles', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const invoice = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-20', amountCents: 23800, paymentReference: 'RE-4711', lineTemplate: [{ categoryId: f.programCosts.id, amountCents: -23800 }] }));
    // Ein Entwurf (von Hand, noch ohne Kontoumsatz) begleicht die Rechnung schon.
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Rechnung', moneyLines: [{ accountId: f.bank.id, amountCents: -23800, settlements: [{ openItemId: invoice.id, amountCents: 23800 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -23800 }] }));
    const paid = insertRaw(f, run, { accountId: f.bank.id, amountCents: -23800, purpose: 'Rechnung RE-4711 vom Februar', iban: null, date: '2026-03-20' });
    const suggestion = await suggest(f, paid);
    expect(suggestion.kind).not.toBe('openItem');
    expect(JSON.stringify(suggestion)).not.toContain(invoice.id);
  });

  it('takes tax code and contact from a template line without category', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    // Wie `createOpenItemFromInvoice` (F5b): die Rechnung kennt keine Vereinskategorie.
    const invoice = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-20', amountCents: 11900, paymentReference: 'TM-2026-0042', lineTemplate: [{ taxCode: 'standard', contactId: f.donor.id }] }));
    const paid = insertRaw(f, run, { accountId: f.bank.id, amountCents: -11900, purpose: 'Rechnung TM-2026-0042', iban: null });
    const suggestion = await suggest(f, paid);
    expect(suggestion).toMatchObject({
      kind: 'openItem', confidence: 'sure',
      reasons: [{ kind: 'paymentReference', openItemId: invoice.id }],
      draft: {
        moneyLines: [{ accountId: f.bank.id, amountCents: -11900, rawTransactionId: paid, settlements: [{ openItemId: invoice.id, amountCents: 11900 }] }],
        allocationLines: [{ categoryId: '', amountCents: -11900, taxCode: 'standard', contactId: f.donor.id }],
      },
    });
    // Die leere Kategorie wählt der Mensch — sie ist kein Problem „Kategorie stillgelegt“.
    expect(suggestion.problems).toEqual([]);
  });

  it('still proposes the remainder of a partially settled open item', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const invoice = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-20', amountCents: 23800, paymentReference: 'RE-4711', lineTemplate: [{ categoryId: f.programCosts.id, amountCents: -23800 }] }));
    // Eine erste Rate ist festgeschrieben — sie steckt schon in openCents; der Rest bleibt offen.
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Rate 1', moneyLines: [{ accountId: f.bank.id, amountCents: -10000, settlements: [{ openItemId: invoice.id, amountCents: 10000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -10000 }] }));
    const paid = insertRaw(f, run, { accountId: f.bank.id, amountCents: -13800, purpose: 'Rechnung RE-4711 Restbetrag', iban: null, date: '2026-03-20' });
    expect(await suggest(f, paid)).toMatchObject({
      kind: 'openItem', confidence: 'sure',
      reasons: [{ kind: 'paymentReference', openItemId: invoice.id }],
      draft: { moneyLines: [{ accountId: f.bank.id, amountCents: -13800, rawTransactionId: paid, settlements: [{ openItemId: invoice.id, amountCents: 13800 }] }] },
    });
  });
});

describe('suggestForTransaction — (4) rules', () => {
  it('applies the first matching active rule in sort order and names it', async () => {
    const f = await ledgerFixture();
    unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Alt', textContains: 'büromaterial', categoryId: f.fees.id, sortOrder: 0, isActive: false }));
    unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Später', textContains: 'büromaterial', categoryId: f.fees.id, sortOrder: 2 }));
    const first = unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Büromaterial', direction: 'out', textContains: 'büromaterial', categoryId: f.programCosts.id, purposeId: f.abroadPurpose.id, taxCode: 'none', entryText: 'Büromaterial', sortOrder: 1 }));
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1990, purpose: 'Bueromaterial Maerz' });
    expect(await suggest(f, rawId)).toMatchObject({
      kind: 'rule', confidence: 'sure', problems: [],
      reasons: [{ kind: 'rule', ruleId: first.id, ruleName: 'Büromaterial' }, { kind: 'contactIban', contactId: f.donor.id }],
      draft: {
        text: 'Büromaterial',
        moneyLines: [{ accountId: f.bank.id, amountCents: -1990, rawTransactionId: rawId }],
        // Die Regel nennt keinen Kontakt — den ergänzt die IBAN.
        allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1990, purposeId: f.abroadPurpose.id, taxCode: 'none', contactId: f.donor.id }],
      },
    });
  });

  it('reports an inactive category of a rule as a problem instead of hiding the suggestion', async () => {
    const f = await ledgerFixture();
    const rule = unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Büromaterial', textContains: 'büromaterial', categoryId: f.programCosts.id }));
    unwrap(await setCategoryActive(f.deps, f.ctx, { id: f.programCosts.id, isActive: false }));
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1990, purpose: 'Büromaterial' });
    expect(await suggest(f, rawId)).toMatchObject({ kind: 'rule', reasons: [{ kind: 'rule', ruleId: rule.id }], problems: ['categoryInactive'] });
  });
});

describe('suggestForTransaction — (5) contact over the iban, and hints', () => {
  it('proposes the contact learned from the iban as unsure', async () => {
    const f = await ledgerFixture();
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    const run = insertRun(f, f.bank.id);
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, purpose: 'Danke' });
    expect(await suggest(f, incoming)).toMatchObject({
      kind: 'contact', confidence: 'unsure',
      reasons: [{ kind: 'contactIban', contactId: f.donor.id }],
      draft: { moneyLines: [{ accountId: f.bank.id, amountCents: 2500, rawTransactionId: incoming }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2500, contactId: f.donor.id }] },
    });
    // Ausgang: keine Vorgabe-Kategorie.
    const outgoing = insertRaw(f, run, { accountId: f.bank.id, amountCents: -700, purpose: 'Erstattung' });
    expect(await suggest(f, outgoing)).toMatchObject({ kind: 'contact', confidence: 'unsure', draft: { allocationLines: [] } });
  });

  it('hints at a foreign iban without proposing anything else', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -40000, iban: 'AT939999900001234567', name: 'Partnerverein', purpose: 'Futter' });
    expect(await suggest(f, rawId)).toEqual({ rawTransactionId: rawId, kind: 'none', confidence: 'unsure', reasons: [], draft: null, linkEntry: null, problems: [], hints: ['foreignIban'] });
  });

  it('gives no foreign-iban hint for payment-service accounts and words it neutrally (Befund 14)', async () => {
    const f = await ledgerFixture();
    const service = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zahlungsdienst', kind: 'paymentService' }));
    // PayPal selbst sitzt in Luxemburg — die eigene Auszahlung an sich hat keine deutsche IBAN.
    const payout = insertRaw(f, insertRun(f, service.id), { accountId: service.id, amountCents: -3200, iban: 'LU280019400644750000', name: 'PayPal', purpose: 'Gebühr' });
    expect((await suggest(f, payout)).hints).toEqual([]);
  });

  it('gives no foreign-iban hint when the counterparty iban belongs to a contact (Befund 14)', async () => {
    const f = await ledgerFixture();
    const foreignIban = 'AT939999900001234567';
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: foreignIban }));
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 2500, iban: foreignIban, name: 'Partnerverein', purpose: 'Danke' });
    expect((await suggest(f, rawId)).hints).toEqual([]);
  });
});

describe('suggestForTransaction — access and input', () => {
  it('needs finance.read, a valid input, a known transaction and a statement not discarded', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 100 });
    const gone = insertRaw(f, insertRun(f, f.bank.id, { discarded: true }), { accountId: f.bank.id, amountCents: 100 });
    expect(await suggestForTransaction(f.deps, ctxWith(['finance.overview']), { rawTransactionId: rawId })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await suggestForTransaction(f.deps, f.ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId: gone })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'rawTransactionDiscarded' } });
  });
});

describe('suggestForTransaction — returns by EndToEndId and with a draft origin (Befund 37)', () => {
  it('matches a return by EndToEndId before iban and amount', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    // Zwei gleich hohe Lastschriften derselben IBAN; die Rückgabe gehört per EndToEndId zur älteren.
    const older = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, date: '2026-02-01', purpose: 'Beitrag Februar', endToEndId: 'LS-2026-0001' });
    const olderEntry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Beitrag Februar', moneyLines: [{ accountId: f.bank.id, amountCents: 2500, rawTransactionId: older }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2500 }] }));
    const newer = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, date: '2026-03-01', purpose: 'Beitrag März', endToEndId: 'LS-2026-0002', lineIndex: 2 });
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Beitrag März', moneyLines: [{ accountId: f.bank.id, amountCents: 2500, rawTransactionId: newer }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2500 }] }));
    const returned = insertRaw(f, run, { accountId: f.bank.id, amountCents: -2500, date: '2026-03-05', purpose: 'Rückgabe', returnCode: 'MD06', endToEndId: 'LS-2026-0001', lineIndex: 3 });
    expect(await suggest(f, returned)).toMatchObject({ kind: 'return', confidence: 'sure', reasons: [{ kind: 'returnCode', entryId: olderEntry.id }] });

    // Ohne IBAN am Umsatz trägt die EndToEndId allein.
    const noIban = insertRaw(f, run, { accountId: f.bank.id, amountCents: -2500, date: '2026-03-06', purpose: 'Rückgabe', returnCode: 'MD06', endToEndId: 'LS-2026-0001', iban: null, name: null, lineIndex: 4 });
    expect(await suggest(f, noIban)).toMatchObject({ kind: 'return', confidence: 'sure', reasons: [{ kind: 'returnCode', entryId: olderEntry.id }] });
  });

  it('proposes a return whose origin is still a draft and says so', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, date: '2026-02-01', purpose: 'Lastschrift Spende' });
    const origin = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 2500, rawTransactionId: incoming }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2500, contactId: f.donor.id }] }));
    const returned = insertRaw(f, run, { accountId: f.bank.id, amountCents: -2500, date: '2026-02-10', purpose: 'Rückgabe', returnCode: 'MD06', lineIndex: 2 });
    const result = await suggest(f, returned);
    expect(result).toMatchObject({
      kind: 'return', confidence: 'unsure', hints: ['originIsDraft'],
      reasons: [{ kind: 'returnCode', entryId: origin.id }],
      draft: { allocationLines: [{ categoryId: f.donations.id, amountCents: -2500, contactId: f.donor.id }] },
    });
    // Der Entwurf kann seine Zeilen noch ändern — der Vorschlag bindet keine `originLineId` an ihn.
    expect(result.draft!.allocationLines[0]!.originLineId ?? null).toBeNull();
  });
});
