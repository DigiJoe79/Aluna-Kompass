import { unwrap, writeSettingInternal } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approveExpenseClaim, approvePartnerPayment } from '../src/allocation/approvals';
import { getPartnerPayment, savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { attachSignedWaiver, createWaiverDeclaration } from '../src/allocation/waiver';
import { systemContext } from '@kompass/core/testing';
import { entryViewInternal } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { financeCategories, financeExpenseClaims, financePartnerPayments } from '../src/schema';
import { approverCtx, enableExpenseWaivers, expenseFixture, expenseSubmitted, type ExpenseFixture } from './expense-fixture';
import { allowHumanOnlyOverMcp } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/**
 * Q Rest (Recheck sha-0170e73): Auch die Freigabe prüft den Zweck im Minus.
 * Die Freigabe einer Auslage legt den Posten bzw. — beim Verzicht — die
 * Buchung an; bei einer Zahlung an Partner kann sich der Bestand zwischen
 * Einreichen und Freigeben geändert haben. Muster AH: Pflichtbegründung,
 * kein Verbot, derselbe Code `purposeGoesNegative`.
 */
async function fixture() {
  const f = await expenseFixture();
  allowHumanOnlyOverMcp(f.deps);
  // 10 € zweckgebunden eingegangen — die Beleg-Position (19,99 €) aus dem Zweck brächte ihn ins Minus.
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Zweckspende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.purposeIncome.id, amountCents: 1000, purposeId: f.abroadPurpose.id }] }));
  return f;
}
const travel = (f: ExpenseFixture) => f.deps.db.select().from(financeCategories).all().find((c) => c.key === 'travel')!.id;
const decisions = (f: ExpenseFixture, claim: { positions: { id: string }[] }, purposeId: string | null) => [
  { positionId: claim.positions[0]!.id, categoryId: f.programCosts.id, purposeId },
  { positionId: claim.positions[1]!.id, categoryId: travel(f) },
];

describe('Q Rest: Zweck im Minus bei der Freigabe einer Auslage', () => {
  it('verlangt eine Begründung, wenn „bezahlt aus“ den Zweck ins Minus brächte, und speichert sie am Antrag', async () => {
    const f = await fixture();
    const claim = await expenseSubmitted(f);
    expect(err(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: decisions(f, claim, f.abroadPurpose.id) }))).toMatchObject({ code: 'purposeGoesNegative', params: { purpose: 'Partnerprojekt Ausland', balance: -999 } });
    const approved = unwrap(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: decisions(f, claim, f.abroadPurpose.id), purposeReason: 'Zuschuss ist zugesagt' }));
    expect(approved.state).toBe('approved');
    expect(f.deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claim.id)).get()!.purposeNegativeReason).toBe('Zuschuss ist zugesagt');
  });

  it('ohne Zweck (oder im Plus) braucht es keine Begründung — und keine wird gespeichert', async () => {
    const f = await fixture();
    const claim = await expenseSubmitted(f);
    unwrap(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: decisions(f, claim, null), purposeReason: 'unnötig' }));
    expect(f.deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claim.id)).get()!.purposeNegativeReason).toBeNull();
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
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: `Empfänger ${cents} e.V.` }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Futter', retroactive: false, positions: [{ kind: 'money', amountCents: cents, categoryId: f.programCosts.id, purposeId: f.abroadPurpose.id }] }));
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
