import { schema, unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, ctxWith, systemContext } from '@kompass/core/testing';
import { contacts } from '@kompass/module-contacts';
import { documentLinks, documents } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approveExpenseClaim, rejectExpenseClaim, waiverChecks } from '../src/allocation/approvals';
import { copyExpenseClaim } from '../src/allocation/expenses';
import { attachSignedWaiver, createWaiverDeclaration, saveContactWaiverTerms } from '../src/allocation/waiver';
import { checkConfirmable } from '../src/donations/check';
import { saveNotice } from '../src/donations/notices';
import { entryViewInternal } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { freeFundsAtInternal } from '../src/ledger/overview';
import { financeCategories, financeContactWaiverTerms, financeExpenseClaims, financeOpenItems } from '../src/schema';
import { EXEMPTION } from './donation-fixture';
import { approverCtx, enableExpenseWaivers, expenseFixture, expenseSubmitted, type ExpenseFixture } from './expense-fixture';

/**
 * F8a Task 3 — der Verzicht (Aufwandsspende, Spec 8.2, E13): vier Prüfungen
 * des Freigebers, Verzichtserklärung, Buchung ohne Geldzeile, die F6a
 * bestätigen kann. Der Antrag: 19,99 € Beleg (2026-08-20) + 25,20 € Fahrt
 * (2026-08-21) = 45,19 €; heute ist der 2026-09-05.
 */
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const TOTAL = 1999 + 2520;

const categoryId = (f: ExpenseFixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!.id;
const categorized = (f: ExpenseFixture, claim: { positions: { id: string }[] }) => [
  { positionId: claim.positions[0]!.id, categoryId: f.programCosts.id },
  { positionId: claim.positions[1]!.id, categoryId: categoryId(f, 'travel') },
];

/** Ein eingereichter Verzicht mit Anspruchsgrundlage des Vereins und 50,00 € auf dem Konto. */
async function waiverClaim(f: ExpenseFixture, o: { recurring?: boolean; funds?: boolean } = {}) {
  enableExpenseWaivers(f);
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiverBasisText', 'Satzung § 7 Abs. 2', 'test'));
  if (o.funds !== false) await f.finalEntry();
  return expenseSubmitted(f, f.hanna, { iban: null, waiver: true, recurring: o.recurring });
}

describe('freeFundsAtInternal', () => {
  it('sums the money accounts minus the earmarked purpose balances at the date', async () => {
    const f = await expenseFixture();
    expect(freeFundsAtInternal(f.deps.db, '2026-09-05')).toBe(0);
    await f.finalEntry();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Zweckspende', moneyLines: [{ accountId: f.bank.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000, purposeId: f.abroadPurpose.id }] }));
    expect(freeFundsAtInternal(f.deps.db, '2026-03-15')).toBe(5000);
    expect(freeFundsAtInternal(f.deps.db, '2026-09-05')).toBe(5000);
  });
});

describe('waiverChecks and approveExpenseClaim with waiver', () => {
  it('waiver: timely by months, late needs a reason, funds insufficient refuses with the calculation, declaration required, confirmation checkbox required', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f, { funds: false });
    const approver = approverCtx(f);
    const approve = (waiver: Record<string, unknown>) => approveExpenseClaim(f.deps, approver, { claimId: claim.id, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05', ...waiver } });

    const checks = unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05' }));
    expect(checks.map((c) => [c.key, c.done, c.blocked])).toEqual([['claimAgreed', false, true], ['timely', true, false], ['fundsAvailable', false, true], ['declaration', false, true]]);
    expect(checks.find((c) => c.key === 'fundsAvailable')!.detail).toEqual({ date: '2026-09-05', freeCents: 0, amountCents: TOTAL });
    expect(checks.find((c) => c.key === 'timely')!.detail).toEqual({ deadline: '2026-11-20' });

    // Frist: einmalige Ansprüche drei Monate nach der frühesten Fälligkeit — bis einschließlich 20.11.
    expect(unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-11-20' })).find((c) => c.key === 'timely')).toMatchObject({ done: true, warning: null });
    expect(unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-11-21' })).find((c) => c.key === 'timely')).toMatchObject({ done: false, blocked: false, warning: 'reasonRequired' });

    expect(err(await approve({ claimAgreedConfirmed: false }))).toMatchObject({ code: 'waiverNotConfirmed' });
    expect(err(await approve({}))).toMatchObject({ code: 'waiverFundsInsufficient', message: expect.stringMatching(/2026-09-05.*0,00 €.*45,19 €/) });
    await f.finalEntry();
    expect(err(await approve({}))).toMatchObject({ code: 'waiverDeclarationMissing' });
    unwrap(await createWaiverDeclaration(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05' }));

    f.deps.clock.set('2026-11-25T10:00:00.000Z');
    expect(err(await approve({ declaredOn: '2026-11-25' }))).toMatchObject({ code: 'waiverLateNeedsReason' });
    expect(err(await approve({ declaredOn: '2026-11-26' }))).toMatchObject({ type: 'validation', issues: [{ path: 'waiver.declaredOn', message: 'inFuture' }] });
    const late = unwrap(await approve({ declaredOn: '2026-11-25', lateReason: 'Helferin war drei Monate im Ausland' }));
    expect(late).toMatchObject({ state: 'approved', waiverLateReason: 'Helferin war drei Monate im Ausland', waiverDeclaredOn: '2026-11-25', claimAgreedConfirmed: true });
    expect(JSON.stringify(f.deps.db.select().from(schema.auditLog).all())).not.toContain('Ausland');
  });

  it('a recurring claim has twelve months, and an agreement after the earliest position needs a reason', async () => {
    const f = await expenseFixture();
    unwrap(await saveContactWaiverTerms(f.deps, f.ctx, { contactId: f.hanna.contactId, basisText: 'Vereinbarung vom 25.08.2026', agreedOn: '2026-08-25' }));
    const claim = await waiverClaim(f, { recurring: true });
    const approver = approverCtx(f);
    unwrap(await createWaiverDeclaration(f.deps, f.hanna.ctx, { claimId: claim.id, declaredOn: '2026-09-05' }));
    const checks = unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05', claimAgreedConfirmed: true }));
    expect(checks.find((c) => c.key === 'timely')!.detail).toEqual({ deadline: '2027-08-20' });
    expect(checks.find((c) => c.key === 'claimAgreed')).toMatchObject({ done: true, blocked: false, warning: 'reasonRequired', detail: { agreedOn: '2026-08-25', earliestPosition: '2026-08-20' } });

    const approve = (waiver: Record<string, unknown>) => approveExpenseClaim(f.deps, approver, { claimId: claim.id, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05', ...waiver } });
    expect(err(await approve({}))).toMatchObject({ code: 'waiverAgreedAfterPosition' });
    expect(unwrap(await approve({ lateReason: 'Mündlich vorher vereinbart, schriftlich nachgeholt' }))).toMatchObject({ state: 'approved', recurring: true });
  });

  it('waiver approval books the expense donation without money line dated on the declaration day and records the free funds', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f);
    const approver = approverCtx(f);
    const declared = unwrap(await createWaiverDeclaration(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-04' }));
    const approved = unwrap(await approveExpenseClaim(f.deps, approver, { claimId: claim.id, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-04' } }));
    expect(approved).toMatchObject({ state: 'approved', openItemId: null, waiverFreeFundsCents: 5000, waiverDeclaredOn: '2026-09-04', claimAgreedConfirmed: true });
    expect(f.deps.db.select().from(financeOpenItems).all()).toEqual([]);

    const entry = entryViewInternal(f.deps.db, approved.entryId!)!;
    expect(entry).toMatchObject({ status: 'final', entryDate: '2026-09-04', text: 'Aufwandsspende KE-2026-001', moneyLines: [], createdByUserId: f.secondPersonId });
    expect(entry.allocationLines.map((l) => [l.categoryId, l.amountCents, l.contactId])).toEqual([
      [f.programCosts.id, -1999, null],
      [categoryId(f, 'travel'), -2520, null],
      [categoryId(f, 'expense-waivers'), TOTAL, f.hanna.contactId],
    ]);
    // Belegt: die Belege der Positionen und die Verzichtserklärung hängen an der Buchung.
    expect(entry.documentation.state).toBe('voucher');
    expect(entry.vouchers.map((v) => v.documentId).sort()).toEqual([claim.positions[0]!.documentId, declared.waiverDeclarationDocumentId].sort());

    expect(JSON.parse(auditEntry(f.deps, 'finance.expenseClaim.approve').after as string)).toEqual({ state: 'approved', number: 'KE-2026-001', positionCount: 2, totalCents: TOTAL, waiver: true, recurring: false, approvedAt: '2026-09-05T08:00:00.000Z', entryId: entry.id, waiverFreeFundsCents: 5000, channel: 'ui' });
    expect(JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action.startsWith('finance.')))).not.toContain('Satzung');
  });

  it('the expense donation line is confirmable through F6a with a signature field', async () => {
    const f = await expenseFixture();
    f.deps.db.transaction((tx) => {
      for (const [key, value] of [['organization.name', 'Musterverein e.V.'], ['organization.street', 'Musterweg 1'], ['organization.postalCode', '12345'], ['organization.city', 'Musterstadt']] as const) writeSettingInternal(tx, f.deps, systemContext(), key, value, 'test');
    });
    f.deps.db.update(contacts).set({ street: 'Beispielstraße 7', postalCode: '54321', city: 'Beispielstadt' }).where(eq(contacts.id, f.hanna.contactId)).run();
    unwrap(await saveNotice(f.deps, f.ctx, EXEMPTION));
    const claim = await waiverClaim(f);
    unwrap(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05' }));
    const approved = unwrap(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05' } }));
    const line = entryViewInternal(f.deps.db, approved.entryId!)!.allocationLines.find((l) => l.amountCents > 0)!;

    const check = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id], issuedOn: '2026-09-05' }));
    expect(check.expenseWaiver).toBe(true);
    expect(check.checks.filter((c) => c.applies && c.blocked).map((c) => c.key)).toEqual([]);
    expect(check.checks.some((c) => c.warning === 'signatureField')).toBe(true);
  });

  it('refuses a waiver while waivers are switched off, offering the copy without waiver', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f);
    unwrap(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05' }));
    enableExpenseWaivers(f, false);
    const refused = await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05' } });
    expect(err(refused)).toMatchObject({ code: 'expenseWaiversDisabled', message: expect.stringContaining('ohne Verzicht neu ein') });
    unwrap(await rejectExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, note: 'Aufwandsspenden ausgeschaltet' }));
    expect(unwrap(await copyExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id }))).toMatchObject({ state: 'draft', waiver: false, copiedFromClaimId: claim.id });
  });

  it('refuses the waiver block on a claim without waiver, and requires it on a claim with one', async () => {
    const f = await expenseFixture();
    const plain = await expenseSubmitted(f);
    expect(err(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: plain.id, positions: categorized(f, plain), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05' } }))).toMatchObject({ type: 'validation', issues: [{ path: 'waiver', message: 'notAWaiverClaim' }] });
    const waived = await waiverClaim(f);
    expect(err(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: waived.id, positions: categorized(f, waived) }))).toMatchObject({ type: 'validation', issues: [{ path: 'waiver', message: 'required' }] });
    expect(err(await waiverChecks(f.deps, approverCtx(f), { claimId: plain.id }))).toMatchObject({ type: 'validation' });
  });
});

describe('createWaiverDeclaration and attachSignedWaiver', () => {
  it('renders the waiver declaration with number, amount and basis; the signed version attaches once', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f);
    expect(err(await createWaiverDeclaration(f.deps, f.otto.ctx, { claimId: claim.id, declaredOn: '2026-09-05' }))).toMatchObject({ code: 'expenseNotOwner' });

    // Die Antragstellerin erzeugt sie selbst — ohne finance.approve, ohne Recht der Akte.
    const declared = unwrap(await createWaiverDeclaration(f.deps, f.hanna.ctx, { claimId: claim.id, declaredOn: '2026-09-05' }));
    expect(declared).toMatchObject({ waiverDeclaredOn: '2026-09-05', waiverDeclarationDocumentId: expect.any(String) });
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, declared.waiverDeclarationDocumentId!)).get()!;
    expect(doc).toMatchObject({ typeKey: 'finance-waiver-declaration', templateKey: 'finance-waiver-declaration', subject: 'Verzichtserklärung zu Antrag KE-2026-001', documentDate: '2026-09-05', number: 'VZE-2026-001' });
    const snapshot = JSON.parse(doc.inputSnapshot!) as { input: Record<string, unknown> };
    expect(snapshot.input).toMatchObject({ claimNumber: 'KE-2026-001', amountCents: TOTAL, basisText: 'Satzung § 7 Abs. 2', declaredOn: '2026-09-05', claimant: { name: 'Hanna Helferin' } });
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'financeExpenseClaim'), eq(documentLinks.entityId, claim.id))).all()).toHaveLength(1);

    // Der Freigeber erzeugt eine neue — der Antrag zeigt auf die jüngste.
    const again = unwrap(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05' }));
    expect(again.waiverDeclarationDocumentId).not.toBe(doc.id);

    // Die unterschriebene Fassung: einmal, auch vom Freigeber ohne finance.expensesSubmit.
    const signed = unwrap(await attachSignedWaiver(f.deps, approverCtx(f), { claimId: claim.id, bytes: f.pdf() }));
    const signedDoc = f.deps.db.select().from(documents).where(eq(documents.id, signed.waiverSignedDocumentId!)).get()!;
    expect(signedDoc).toMatchObject({ typeKey: 'finance-waiver-signed', direction: 'incoming', subject: 'Verzichtserklärung zu Antrag KE-2026-001 unterschrieben' });
    expect(err(await attachSignedWaiver(f.deps, f.hanna.ctx, { claimId: claim.id, bytes: f.pdf() }))).toMatchObject({ code: 'waiverSignedAlready' });
    expect(err(await attachSignedWaiver(f.deps, f.otto.ctx, { claimId: claim.id, bytes: f.pdf() }))).toMatchObject({ code: 'expenseNotOwner' });

    expect(JSON.parse(auditEntry(f.deps, 'finance.expenseClaim.waiverDeclaration').after as string)).toEqual({ state: 'submitted', number: 'KE-2026-001' });
    expect(JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action.startsWith('finance.')))).not.toContain('Satzung');
  });

  it('refuses a declaration for a claim without waiver or no longer waiting', async () => {
    const f = await expenseFixture();
    const plain = await expenseSubmitted(f);
    expect(err(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: plain.id, declaredOn: '2026-09-05' }))).toMatchObject({ type: 'validation', issues: [{ path: 'claimId', message: 'notAWaiverClaim' }] });
    expect(err(await createWaiverDeclaration(f.deps, ctxWith(['finance.read'], f.secondPersonId), { claimId: plain.id, declaredOn: '2026-09-05' }))).toMatchObject({ type: 'forbidden' });
    const waived = await waiverClaim(f);
    unwrap(await rejectExpenseClaim(f.deps, approverCtx(f), { claimId: waived.id, note: 'x' }));
    expect(err(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: waived.id, declaredOn: '2026-09-05' }))).toMatchObject({ code: 'expenseNotSubmitted' });
  });
});

describe('saveContactWaiverTerms', () => {
  it('saves the agreement of a person under finance.setup, logging only the date', async () => {
    const f = await expenseFixture();
    const saved = unwrap(await saveContactWaiverTerms(f.deps, f.ctx, { contactId: f.hanna.contactId, basisText: 'Vereinbarung vom 02.01.2026', agreedOn: '2026-01-02' }));
    expect(saved).toMatchObject({ contactId: f.hanna.contactId, basisText: 'Vereinbarung vom 02.01.2026', agreedOn: '2026-01-02', updatedByUserId: f.userId });
    unwrap(await saveContactWaiverTerms(f.deps, f.ctx, { contactId: f.hanna.contactId, basisText: 'Vereinbarung vom 03.01.2026', agreedOn: '2026-01-03' }));
    expect(f.deps.db.select().from(financeContactWaiverTerms).all()).toEqual([expect.objectContaining({ basisText: 'Vereinbarung vom 03.01.2026', agreedOn: '2026-01-03' })]);
    expect(JSON.parse(auditEntry(f.deps, 'finance.contactWaiverTerms.save').after as string)).toEqual({ agreedOn: '2026-01-03' });
    expect(JSON.stringify(f.deps.db.select().from(schema.auditLog).all())).not.toContain('Vereinbarung');

    expect(err(await saveContactWaiverTerms(f.deps, ctxWith(['finance.approve', 'finance.read'], f.secondPersonId), { contactId: f.hanna.contactId, basisText: 'x', agreedOn: '2026-01-02' }))).toMatchObject({ type: 'forbidden', permission: 'finance.setup' });
    expect(err(await saveContactWaiverTerms(f.deps, f.ctx, { contactId: f.hanna.contactId, basisText: '', agreedOn: '2026-01-02' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveContactWaiverTerms(f.deps, f.ctx, { contactId: 'NOPE', basisText: 'x', agreedOn: '2026-01-02' }))).toMatchObject({ type: 'notFound' });
    expect(f.deps.db.select().from(financeExpenseClaims).all()).toEqual([]);
  });
});
