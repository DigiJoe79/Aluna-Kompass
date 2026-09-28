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
import { approverCtx, enableExpenseWaivers, expenseFixture, expenseReadyDraft, expenseSubmitted, type ExpenseFixture } from './expense-fixture';
import { getExpenseClaim, saveExpenseDraft, submitExpenseClaim } from '../src/allocation/expenses';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { insertReserve, insertReserveMovement } from './mittel-fixture';

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

/**
 * Ein eingereichter Verzicht mit einer Grundlage, die jünger ist als die früheste Position — so kommt er seit der
 * Prüfer-Fixrunde 28.09. nicht mehr durchs Einreichen, nur noch als Altbestand. Nachgestellt, indem der Entwurf
 * direkt auf „eingereicht“ gesetzt wird (vor dem Einreichen gilt die Sperre des Triggers noch nicht).
 */
async function legacyLateWaiverClaim(f: ExpenseFixture, agreedOn: string, o: { recurring?: boolean } = {}) {
  enableExpenseWaivers(f);
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiverBasisText', 'Satzung § 7 Abs. 2', 'test'));
  await f.finalEntry();
  const draft = await expenseReadyDraft(f, f.hanna, { iban: null, waiver: true, recurring: o.recurring });
  f.deps.db.update(financeExpenseClaims).set({ state: 'submitted', number: 'KE-2026-901', submittedAt: '2026-09-01T10:00:00.000Z', submittedByUserId: f.hanna.ctx.userId!, waiverBasisText: 'Vereinbarung', waiverAgreedOn: agreedOn }).where(eq(financeExpenseClaims.id, draft.id)).run();
  return unwrap(await getExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id }));
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

  it('rechnet nach zurückgelegtem Geld — mit Zweckbezug nur, soweit es über dem Zweckbestand liegt (F8b Annahme 3, Review Focus 4)', async () => {
    const f = await expenseFixture();
    await f.finalEntry();
    const reserveId = insertReserve(f.deps.db, { kind: 'free' });
    insertReserveMovement(f.deps.db, reserveId, { movementDate: '2026-01-15', amountCents: 2000 });
    expect(freeFundsAtInternal(f.deps.db, '2026-09-05')).toBe(5000 - 2000);
  });
});

describe('waiverChecks and approveExpenseClaim with waiver', () => {
  it('waiver: timely by months, late needs a reason, funds insufficient refuses with the calculation, declaration required, confirmation checkbox required', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f, { funds: false });
    const approver = approverCtx(f);
    const approve = (waiver: Record<string, unknown>) => approveExpenseClaim(f.deps, approver, { claimId: claim.id, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05', ...waiver } });

    const checks = unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05' }));
    expect(checks.map((c) => [c.key, c.done, c.blocked])).toEqual([['claimAgreed', false, true], ['timely', true, false], ['fundsAvailable', false, true], ['declaration', false, true], ['declarationSigned', false, true]]);
    expect(checks.find((c) => c.key === 'fundsAvailable')!.detail).toEqual({ date: '2026-09-05', freeCents: 0, amountCents: TOTAL });
    expect(checks.find((c) => c.key === 'timely')!.detail).toEqual({ deadline: '2026-11-20' });

    // Frist: einmalige Ansprüche drei Monate nach der frühesten Fälligkeit — bis einschließlich 20.11.
    expect(unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-11-20' })).find((c) => c.key === 'timely')).toMatchObject({ done: true, warning: null });
    expect(unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-11-21' })).find((c) => c.key === 'timely')).toMatchObject({ done: false, blocked: false, warning: 'reasonRequired' });

    expect(err(await approve({ claimAgreedConfirmed: false }))).toMatchObject({ code: 'waiverNotConfirmed' });
    expect(err(await approve({}))).toMatchObject({ code: 'waiverFundsInsufficient', params: { date: '2026-09-05', free: 0, amount: 4519 } });
    await f.finalEntry();
    expect(err(await approve({}))).toMatchObject({ code: 'waiverDeclarationMissing' });
    unwrap(await createWaiverDeclaration(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05' }));
    // Befund H: erzeugt ist nicht unterschrieben — die Freigabe verlangt die unterschriebene Fassung.
    expect(unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05', claimAgreedConfirmed: true })).find((c) => c.key === 'declarationSigned')).toMatchObject({ done: false, blocked: true });
    expect(err(await approve({}))).toMatchObject({ code: 'waiverSignedMissing' });
    unwrap(await attachSignedWaiver(f.deps, approver, { claimId: claim.id, bytes: f.pdf() }));
    expect(unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05', claimAgreedConfirmed: true })).find((c) => c.key === 'declarationSigned')).toMatchObject({ done: true, blocked: false });

    f.deps.clock.set('2026-11-25T10:00:00.000Z');
    expect(err(await approve({ declaredOn: '2026-11-25' }))).toMatchObject({ code: 'waiverLateNeedsReason' });
    expect(err(await approve({ declaredOn: '2026-11-26' }))).toMatchObject({ type: 'validation', issues: [{ path: 'waiver.declaredOn', message: 'inFuture' }] });
    const late = unwrap(await approve({ declaredOn: '2026-11-25', lateReason: 'Helferin war drei Monate im Ausland' }));
    expect(late).toMatchObject({ state: 'approved', waiverLateReason: 'Helferin war drei Monate im Ausland', waiverDeclaredOn: '2026-11-25', claimAgreedConfirmed: true });
    expect(JSON.stringify(f.deps.db.select().from(schema.auditLog).all())).not.toContain('Ausland');
  });

  it('N6: the refusal names every unmet requirement at once, not only the first', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f, { funds: false });
    const denied = await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: false, declaredOn: '2026-09-05' } });
    expect(err(denied)).toMatchObject({
      type: 'conflict', code: 'waiverNotConfirmed', messageKey: 'finance.errors.waiverNotConfirmed',
      also: [
        { code: 'waiverFundsInsufficient', messageKey: 'finance.errors.waiverFundsInsufficient', params: { date: '2026-09-05', free: 0, amount: TOTAL } },
        { code: 'waiverDeclarationMissing', messageKey: 'finance.errors.waiverDeclarationMissing' },
        { code: 'waiverSignedMissing', messageKey: 'finance.errors.waiverSignedMissing' },
      ],
    });
  });

  it('J Rest: a recurring claim has twelve months, and an agreement after the earliest position blocks — no reason heals it, no declaration is printed', async () => {
    const f = await expenseFixture();
    unwrap(await saveContactWaiverTerms(f.deps, f.ctx, { contactId: f.hanna.contactId, basisText: 'Vereinbarung vom 25.08.2026', agreedOn: '2026-08-25' }));
    const claim = await legacyLateWaiverClaim(f, '2026-08-25', { recurring: true });
    const approver = approverCtx(f);
    const checks = unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05', claimAgreedConfirmed: true }));
    expect(checks.find((c) => c.key === 'timely')!.detail).toEqual({ deadline: '2027-08-20' });
    expect(checks.find((c) => c.key === 'claimAgreed')).toMatchObject({ done: false, blocked: true, warning: null, detail: { agreedOn: '2026-08-25', earliestPosition: '2026-08-20' } });
    // BMF 25.11.2014: Der Anspruch muss vor der Tätigkeit eingeräumt sein — die Erklärung entsteht gar nicht erst.
    expect(err(await createWaiverDeclaration(f.deps, f.hanna.ctx, { claimId: claim.id, declaredOn: '2026-09-05' }))).toMatchObject({ code: 'waiverAgreedAfterPosition' });

    const approve = (waiver: Record<string, unknown>) => approveExpenseClaim(f.deps, approver, { claimId: claim.id, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05', ...waiver } });
    expect(err(await approve({}))).toMatchObject({ code: 'waiverAgreedAfterPosition' });
    expect(err(await approve({ lateReason: 'Mündlich vorher vereinbart, schriftlich nachgeholt' }))).toMatchObject({ code: 'waiverAgreedAfterPosition' });

    // Prüfer-Fixrunde 28.09., Punkt 1: Ohne Häkchen kommt nicht zusätzlich „setzen Sie das Häkchen“ — das Häkchen könnte nichts retten.
    const unchecked = await approve({ claimAgreedConfirmed: false });
    expect(err(unchecked)).toMatchObject({ code: 'waiverAgreedAfterPosition' });
    expect(JSON.stringify(unchecked)).not.toContain('waiverNotConfirmed');
    const precheck = unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05', claimAgreedConfirmed: false }));
    expect(precheck.find((c) => c.key === 'claimAgreed')).toMatchObject({ blocked: true, detail: { blockedBy: 'agreedAfterPosition' } });
  });

  it('Prüfer-Fixrunde 28.09.: the pre-check names why the agreement is missing — the checkbox, or nothing at all when all is well', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f);
    const approver = approverCtx(f);
    const claimAgreed = async (confirmed: boolean) => unwrap(await waiverChecks(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-05', claimAgreedConfirmed: confirmed })).find((c) => c.key === 'claimAgreed')!;
    expect(await claimAgreed(false)).toMatchObject({ blocked: true, detail: { blockedBy: 'notConfirmed' } });
    expect(await claimAgreed(true)).toMatchObject({ blocked: false, done: true, detail: { blockedBy: null } });
  });

  it('J Rest: the association basis carries its date — before or on the day of the earliest position it holds, after it blocks', async () => {
    const f = await expenseFixture();
    await waiverClaim(f);
    const check = async (agreedOn: string) => {
      f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiverBasisAgreedOn', agreedOn, 'test'));
      const claim = await expenseSubmitted(f, f.hanna, { iban: null, waiver: true });
      expect(claim.waiverAgreedOn).toBe(agreedOn);
      return unwrap(await waiverChecks(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05', claimAgreedConfirmed: true })).find((c) => c.key === 'claimAgreed');
    };
    expect(await check('2026-08-20')).toMatchObject({ done: true, blocked: false, warning: null });
    expect(await check('2026-08-01')).toMatchObject({ done: true, blocked: false, warning: null });
  });

  it('Prüfer-Fixrunde 28.09., Punkt 4: a draft whose basis is younger than its earliest position warns, submitting it as a waiver is refused, as a reimbursement it goes through', async () => {
    const f = await expenseFixture();
    await waiverClaim(f);
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiverBasisAgreedOn', '2026-08-21', 'test'));
    const draft = await expenseReadyDraft(f, f.hanna, { iban: null, waiver: true });
    expect(draft.warnings).toContain('waiverAgreedAfterPosition');
    expect(unwrap(await getExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id })).warnings).toContain('waiverAgreedAfterPosition');
    expect(err(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id, expectedVersion: draft.version }))).toMatchObject({ code: 'waiverAgreedAfterPosition' });

    const asReimbursement = unwrap(await saveExpenseDraft(f.deps, f.hanna.ctx, { id: draft.id, expectedVersion: draft.version, iban: 'DE66999999991234567890', waiver: false, recurring: false, positions: draft.positions.map((p) => ({ id: p.id, kind: p.kind, positionDate: p.positionDate, amountCents: p.amountCents, purpose: p.purpose, tripFrom: p.tripFrom, tripTo: p.tripTo, tripReason: p.tripReason, tripKm: p.tripKm })) }));
    expect(asReimbursement.warnings).not.toContain('waiverAgreedAfterPosition');
    expect(unwrap(await submitExpenseClaim(f.deps, f.hanna.ctx, { id: draft.id, expectedVersion: asReimbursement.version })).state).toBe('submitted');
  });

  it('Prüfer-Fixrunde 28.09., Punkt 4, über MCP: dieselbe Warnung am Entwurf, dieselbe Ablehnung beim Einreichen', async () => {
    const f = await expenseFixture();
    await waiverClaim(f);
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiverBasisAgreedOn', '2026-08-21', 'test'));
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((x) => x.name === name)!;
    const agent = { ...f.hanna.ctx, channel: 'mcp' as const };
    const draft = await expenseReadyDraft(f, f.hanna, { iban: null, waiver: true });
    const read = await tool('finance_expense_get').handler(f.deps, agent, { id: draft.id });
    expect(JSON.stringify(read)).toContain('waiverAgreedAfterPosition');
    const submitted = await tool('finance_expense_submit').handler(f.deps, agent, { id: draft.id, expectedVersion: draft.version });
    expect(err(submitted as never)).toMatchObject({ code: 'waiverAgreedAfterPosition' });
  });

  it('waiver approval books the expense donation without money line dated on the declaration day and records the free funds', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f);
    const approver = approverCtx(f);
    const declared = unwrap(await createWaiverDeclaration(f.deps, approver, { claimId: claim.id, declaredOn: '2026-09-04' }));
    const signed = unwrap(await attachSignedWaiver(f.deps, approver, { claimId: claim.id, bytes: f.pdf() }));
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
    // Belegt: die Belege der Positionen, die Verzichtserklärung und ihre unterschriebene Fassung hängen an der Buchung.
    expect(entry.documentation.state).toBe('voucher');
    expect(entry.vouchers.map((v) => v.documentId).sort()).toEqual([claim.positions[0]!.documentId, declared.waiverDeclarationDocumentId, signed.waiverSignedDocumentId].sort());

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
    unwrap(await attachSignedWaiver(f.deps, approverCtx(f), { claimId: claim.id, bytes: f.pdf() }));
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
    expect(err(refused)).toMatchObject({ code: 'expenseWaiversDisabled', messageKey: 'finance.errors.expenseWaiversDisabled' });
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

  it('Befund I: attaching the signed version changes the version — an approval with the version from before is stale', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f);
    const declared = unwrap(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05' }));
    f.deps.clock.set('2026-09-05T08:05:00.000Z');
    const signed = unwrap(await attachSignedWaiver(f.deps, approverCtx(f), { claimId: claim.id, bytes: f.pdf() }));
    expect(signed.version).not.toBe(declared.version);
    const stale = await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, expectedVersion: declared.version, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05' } });
    expect(err(stale)).toMatchObject({ type: 'conflict', code: 'staleVersion' });
    expect(unwrap(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, expectedVersion: signed.version, positions: categorized(f, claim), waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05' } }))).toMatchObject({ state: 'approved' });
  });

  it('Befund G: the declaration prints the country only for an address abroad — like the confirmations', async () => {
    const f = await expenseFixture();
    const claim = await waiverClaim(f);
    const claimantLines = (documentId: string) => (JSON.parse(f.deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!.inputSnapshot!) as { input: { claimant: { addressLines: string[] } } }).input.claimant.addressLines;
    f.deps.db.update(contacts).set({ street: 'Beispielstraße 7', postalCode: '54321', city: 'Beispielstadt', country: 'DE' }).where(eq(contacts.id, f.hanna.contactId)).run();
    const home = unwrap(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05' }));
    expect(claimantLines(home.waiverDeclarationDocumentId!)).toEqual(['Beispielstraße 7', '54321 Beispielstadt']);
    f.deps.db.update(contacts).set({ country: 'at' }).where(eq(contacts.id, f.hanna.contactId)).run();
    const abroad = unwrap(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05' }));
    expect(claimantLines(abroad.waiverDeclarationDocumentId!)).toEqual(['Beispielstraße 7', '54321 Beispielstadt', 'AT']);
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
