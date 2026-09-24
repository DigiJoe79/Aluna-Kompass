import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { linkContactIban } from '../src/import/contact-ibans';
import { saveImportRule } from '../src/import/rules';
import { suggestForTransaction } from '../src/import/suggestions';
import { createAccount } from '../src/ledger/accounts';
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
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value, 'test.setting'));
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
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -40000, iban: 'AT611904300234573201', name: 'Partnerverein', purpose: 'Futter' });
    expect(await suggest(f, rawId)).toEqual({ rawTransactionId: rawId, kind: 'none', confidence: 'unsure', reasons: [], draft: null, linkEntry: null, problems: [], hints: ['foreignIban'] });
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
