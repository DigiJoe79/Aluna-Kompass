import { unwrap, writeSettingInternal, type Result } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approveExpenseClaim, approvePartnerPayment } from '../src/allocation/approvals';
import { getPartnerPayment, savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { attachSignedWaiver, createWaiverDeclaration } from '../src/allocation/waiver';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { entryViewInternal, saveDraft } from '../src/ledger/entries';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { financeAllocationCorrections, financeCategories, financeEntries, financeExpenseClaims, financePartnerPayments } from '../src/schema';
import { approverCtx, enableExpenseWaivers, expenseFixture, expenseSubmitted, type ExpenseFixture } from './expense-fixture';
import { allowHumanOnlyOverMcp } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/**
 * Zweck ins Minus (Befund Q, Q Rest, Befund 1 0.2.1, Befund 7): Wer einen Zweck durch einen Vorgang ins Minus bringt,
 * gibt eine Begründung an (Muster AH) — kein Verbot, derselbe Code `purposeGoesNegative`, die Begründung bleibt am
 * Datensatz. Die Regel liegt zentral in `ledger/purpose-negative.ts`; hier einmal über alle Eingänge
 * (Testdurchsicht 2026-10-22, Plan P4 Task 4), danach die Fälle, in denen ein Eingang mehr tut als die Regel.
 */
async function fixture(incomeCents = 1000) {
  const f = await expenseFixture();
  allowHumanOnlyOverMcp(f.deps);
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Zweckspende', moneyLines: [{ accountId: f.bank.id, amountCents: incomeCents }], allocationLines: [{ categoryId: f.purposeIncome.id, amountCents: incomeCents, purposeId: f.abroadPurpose.id }] }));
  return f;
}
const travel = (f: ExpenseFixture) => f.deps.db.select().from(financeCategories).all().find((c) => c.key === 'travel')!.id;
const spendInput = (f: ExpenseFixture, cents: number, purposeId: string | null = f.abroadPurpose.id) => ({ entryDate: '2026-03-10', text: 'Ausgabe für den Zweck', moneyLines: [{ accountId: f.bank.id, amountCents: -cents }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -cents, ...(purposeId ? { purposeId } : {}) }] });
let partnerCount = 0;
async function partnerDraft(f: ExpenseFixture, cents: number) {
  const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: `Empfängerverein ${++partnerCount} e.V.` }));
  const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
  return unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Futter', retroactive: false, positions: [{ kind: 'money', amountCents: cents, categoryId: f.programCosts.id, purposeId: f.abroadPurpose.id }] }));
}
const decisions = (f: ExpenseFixture, claim: { positions: { id: string }[] }, purposeId: string | null) => [
  { positionId: claim.positions[0]!.id, categoryId: f.programCosts.id, purposeId },
  { positionId: claim.positions[1]!.id, categoryId: travel(f) },
];

/** Ein Eingang: führt den Vorgang über `cents` aus dem Zweck aus und sagt, welche Begründung danach am Datensatz steht. */
interface Entrance {
  cents: number;
  run(f: ExpenseFixture, reason?: string): Promise<{ result: Result<unknown>; stored: () => string | null }>;
}
const ENTRANCES: Record<string, Entrance> = {
  bookEntry: {
    cents: 3000,
    async run(f, reason) {
      const result = await bookEntry(f.deps, f.ctx, { ...spendInput(f, 3000), ...(reason ? { reason } : {}) });
      return { result, stored: () => (result.ok ? result.value.purposeNegativeReason : null) };
    },
  },
  'finalizeEntry (Begründung am Entwurf)': {
    cents: 3000,
    async run(f, reason) {
      const draft = unwrap(await saveDraft(f.deps, f.ctx, { ...spendInput(f, 3000), ...(reason ? { reason } : {}) }));
      const result = await finalizeEntry(f.deps, f.ctx, { id: draft.id });
      return { result, stored: () => f.deps.db.select().from(financeEntries).where(eq(financeEntries.id, draft.id)).get()!.purposeNegativeReason };
    },
  },
  submitPartnerPayment: {
    cents: 3000,
    async run(f, reason) {
      const draft = await partnerDraft(f, 3000);
      const result = await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, ...(reason ? { purposeReason: reason } : {}) });
      return { result, stored: () => f.deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, draft.id)).get()!.purposeNegativeReason };
    },
  },
  approveExpenseClaim: {
    cents: 1999,
    async run(f, reason) {
      const claim = await expenseSubmitted(f);
      const result = await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: decisions(f, claim, f.abroadPurpose.id), ...(reason ? { purposeReason: reason } : {}) });
      return { result, stored: () => f.deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claim.id)).get()!.purposeNegativeReason };
    },
  },
  'requestAllocationCorrection (Befund 7)': {
    cents: 3000,
    async run(f, reason) {
      const entry = unwrap(await bookEntry(f.deps, f.ctx, spendInput(f, 3000, null)));
      const result = await requestAllocationCorrection(f.deps, f.ctx, { lineId: entry.allocationLines[0]!.id, changes: { purposeId: f.abroadPurpose.id }, note: 'x', ...(reason ? { purposeReason: reason } : {}) });
      return { result, stored: () => f.deps.db.select().from(financeAllocationCorrections).all().at(-1)?.purposeNegativeReason ?? null };
    },
  },
};

describe('Zweck ins Minus, über jeden Eingang', () => {
  it.each(Object.entries(ENTRANCES))('%s: verlangt die Begründung, speichert sie mit — und braucht im Plus keine', async (_name, entrance) => {
    const f = await fixture(entrance.cents - 1000);
    const refused = await entrance.run(f);
    expect(err(refused.result)).toMatchObject({ type: 'conflict', code: 'purposeGoesNegative', params: { purpose: 'Partnerprojekt Ausland', balance: -1000 } });
    const given = await entrance.run(f, 'Vorschuss, Spenden sind zugesagt');
    expect(given.result.ok).toBe(true);
    expect(given.stored()).toBe('Vorschuss, Spenden sind zugesagt');

    const plus = await fixture(entrance.cents + 1000);
    const unneeded = await entrance.run(plus, 'unnötig');
    expect(unneeded.result.ok).toBe(true);
    expect(unneeded.stored()).toBeNull();
  });
});

describe('Zweck ins Minus: was einzelne Eingänge darüber hinaus tun', () => {
  it('eine Zahlung an Partner fragt schon am Entwurf (reasonsNeeded.purpose) und nach dem Einreichen nicht mehr', async () => {
    const f = await fixture();
    const draft = await partnerDraft(f, 3000);
    expect(draft.reasonsNeeded).toMatchObject({ purpose: true });
    unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, purposeReason: 'Vorschuss' }));
    expect(unwrap(await getPartnerPayment(f.deps, f.ctx, { id: draft.id })).reasonsNeeded).toMatchObject({ purpose: false });
  });

  it('beim Verzicht steht die Begründung an der Buchung der Aufwandsspende, wie beim Festschreiben', async () => {
    const f = await fixture();
    enableExpenseWaivers(f);
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiverBasisText', 'Satzung § 7 Abs. 2'));
    await f.finalEntry();
    const claim = await expenseSubmitted(f, f.hanna, { iban: null, waiver: true });
    unwrap(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05' }));
    unwrap(await attachSignedWaiver(f.deps, approverCtx(f), { claimId: claim.id, bytes: f.pdf() }));
    const input = { claimId: claim.id, positions: decisions(f, claim, f.abroadPurpose.id), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05' } };
    expect(err(await approveExpenseClaim(f.deps, approverCtx(f), input))).toMatchObject({ code: 'purposeGoesNegative' });
    const approved = unwrap(await approveExpenseClaim(f.deps, approverCtx(f), { ...input, purposeReason: 'Vorschuss aus freien Mitteln' }));
    expect(entryViewInternal(f.deps.db, approved.entryId!)!.purposeNegativeReason).toBe('Vorschuss aus freien Mitteln');
  });
});

describe('Q Rest: Zweck im Minus bei der Freigabe einer Zahlung an Partner', () => {
  async function submitted(f: ExpenseFixture, cents: number, purposeReason?: string) {
    const draft = await partnerDraft(f, cents);
    return unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, ...(purposeReason ? { purposeReason } : {}) }));
  }
  const spend = (f: ExpenseFixture, cents: number) => bookEntry(f.deps, f.ctx, { entryDate: '2026-03-10', text: 'Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -cents }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -cents, purposeId: f.abroadPurpose.id }] });

  it('hat sich der Bestand seit dem Einreichen geändert, fragt die Freigabe nach (vorab und beim Freigeben) und speichert die Begründung', async () => {
    const f = await fixture();
    const payment = await submitted(f, 800); // 10 € − 8 € — beim Einreichen im Plus
    unwrap(await spend(f, 500)); // danach stünde der Zweck bei −3 €
    expect(unwrap(await getPartnerPayment(f.deps, f.secondPerson, { id: payment.id })).reasonsNeeded).toMatchObject({ purpose: true });
    expect(err(await approvePartnerPayment(f.deps, f.secondPerson, { id: payment.id, expectedVersion: payment.version }))).toMatchObject({ code: 'purposeGoesNegative', params: { purpose: 'Partnerprojekt Ausland', balance: -300 } });
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: payment.id, expectedVersion: payment.version, purposeReason: 'Spenden sind angekündigt' }));
    expect(approved.state).toBe('approved');
    expect(f.deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, payment.id)).get()!.purposeNegativeReason).toBe('Spenden sind angekündigt');
  });

  it('eine Begründung vom Einreichen genügt auch bei der Freigabe', async () => {
    const f = await fixture();
    const payment = await submitted(f, 3000, 'Vorschuss, Spenden sind zugesagt');
    expect(unwrap(await getPartnerPayment(f.deps, f.secondPerson, { id: payment.id })).reasonsNeeded).toMatchObject({ purpose: false });
    unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: payment.id, expectedVersion: payment.version }));
    expect(f.deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, payment.id)).get()!.purposeNegativeReason).toBe('Vorschuss, Spenden sind zugesagt');
  });

  it('per MCP dieselben Felder: purposeReason an beiden Freigabe-Werkzeugen', () => {
    for (const name of ['finance_expense_approve', 'finance_partner_payment_approve']) {
      const tool = FINANCE_MCP_TOOLS.find((t) => t.name === name)!;
      expect(Object.keys((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape)).toContain('purposeReason');
      expect(tool.description).toContain('purposeGoesNegative');
    }
  });
});

const reasonOf = (f: ExpenseFixture, id: string) => f.deps.db.select().from(financeEntries).where(eq(financeEntries.id, id)).get()!.purposeNegativeReason;

/** Der Antrag wird freigegeben (19,99 € aus dem Zweck) und ergibt einen offenen Posten über 45,19 €. */
async function approvedClaim(f: ExpenseFixture, purposeReason?: string) {
  const claim = await expenseSubmitted(f);
  return unwrap(
    await approveExpenseClaim(f.deps, approverCtx(f), {
      claimId: claim.id,
      positions: [
        { positionId: claim.positions[0]!.id, categoryId: f.programCosts.id, purposeId: f.abroadPurpose.id },
        { positionId: claim.positions[1]!.id, categoryId: travel(f) },
      ],
      ...(purposeReason ? { purposeReason } : {}),
    }),
  );
}
const payment = (f: ExpenseFixture, openItemId: string) => ({
  entryDate: '2026-09-05',
  text: 'Auslagenerstattung',
  moneyLines: [{ accountId: f.bank.id, amountCents: -4519, settlements: [{ openItemId, amountCents: 4519 }] }],
  allocationLines: [
    { categoryId: f.programCosts.id, amountCents: -1999, purposeId: f.abroadPurpose.id },
    { categoryId: travel(f), amountCents: -2520 },
  ],
});
const other = (f: ExpenseFixture) => ({ entryDate: '2026-09-05', text: 'Andere Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -1999 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1999, purposeId: f.abroadPurpose.id }] });

describe('Befund 1: Begründung vom Antrag gilt beim Festschreiben über den Posten', () => {
  it('ein Entwurf über den Posten der Auslage wird ohne zweite Begründung festgeschrieben und trägt die Begründung des Antrags', async () => {
    const f = await fixture();
    const approved = await approvedClaim(f, 'Zuschuss ist zugesagt');
    const draft = unwrap(await saveDraft(f.deps, f.ctx, payment(f, approved.openItemId!)));
    expect(unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id })).status).toBe('final');
    expect(reasonOf(f, draft.id)).toBe('Zuschuss ist zugesagt');
  });

  it('bookEntry über den Posten braucht ebenfalls keine zweite Begründung', async () => {
    const f = await fixture();
    const approved = await approvedClaim(f, 'Zuschuss ist zugesagt');
    const booked = unwrap(await bookEntry(f.deps, f.ctx, payment(f, approved.openItemId!)));
    expect(booked.purposeNegativeReason).toBe('Zuschuss ist zugesagt');
  });

  it('dasselbe für den Posten einer Zahlung an Partner', async () => {
    const f = await fixture();
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Empfängerverein e.V.' }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Futter', retroactive: false, positions: [{ kind: 'money', amountCents: 3000, categoryId: f.programCosts.id, purposeId: f.abroadPurpose.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, purposeReason: 'Vorschuss, Spenden sind zugesagt' }));
    const approved = unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    const booked = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-09-05',
        text: 'Förderung',
        moneyLines: [{ accountId: f.bank.id, amountCents: -3000, settlements: [{ openItemId: approved.openItemId!, amountCents: 3000 }] }],
        allocationLines: [{ categoryId: f.programCosts.id, amountCents: -3000, purposeId: f.abroadPurpose.id }],
      }),
    );
    expect(booked.purposeNegativeReason).toBe('Vorschuss, Spenden sind zugesagt');
  });

  it('eine Buchung ohne Posten auf denselben Zweck bleibt begründungspflichtig', async () => {
    const f = await fixture();
    await approvedClaim(f, 'Zuschuss ist zugesagt');
    const draft = unwrap(await saveDraft(f.deps, f.ctx, other(f)));
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: draft.id }))).toMatchObject({ code: 'purposeGoesNegative' });
    expect(err(await bookEntry(f.deps, f.ctx, other(f)))).toMatchObject({ code: 'purposeGoesNegative' });
  });

  it('hatte der Antrag keine Begründung (der Zweck war da noch im Plus), bleibt sie bei der Zahlung Pflicht', async () => {
    const f = await fixture(3000);
    const approved = await approvedClaim(f); // 19,99 € aus 30 €: keine Begründung nötig
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Zwischendurch', moneyLines: [{ accountId: f.bank.id, amountCents: -2000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -2000, purposeId: f.abroadPurpose.id }] }));
    expect(err(await bookEntry(f.deps, f.ctx, payment(f, approved.openItemId!)))).toMatchObject({ code: 'purposeGoesNegative' });
  });
});
