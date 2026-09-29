import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approveExpenseClaim, approvePartnerPayment } from '../src/allocation/approvals';
import { savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { financeCategories, financeEntries } from '../src/schema';
import { approverCtx, expenseFixture, expenseSubmitted, type ExpenseFixture } from './expense-fixture';
import { allowHumanOnlyOverMcp } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/**
 * Befund 1 (0.2.1): Die Begründung „Zweck im Minus“ wurde bei der Freigabe gegeben und bei der Zahlung ein zweites Mal
 * verlangt. Läuft die Buchung über den Posten des Antrags, gilt die Begründung des Antrags; jede andere Buchung auf den
 * Zweck bleibt begründungspflichtig.
 */
async function fixture(cents = 1000) {
  const f = await expenseFixture();
  allowHumanOnlyOverMcp(f.deps);
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Zweckspende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents, purposeId: f.abroadPurpose.id }] }));
  return f;
}
const travel = (f: ExpenseFixture) => f.deps.db.select().from(financeCategories).all().find((c) => c.key === 'travel')!.id;
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
