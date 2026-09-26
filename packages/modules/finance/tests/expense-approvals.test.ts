import { newId, schema, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approveExpenseClaim, getApproval, listApprovals, rejectExpenseClaim } from '../src/allocation/approvals';
import { getExpenseClaim } from '../src/allocation/expenses';
import { suggestExpenseCategories } from '../src/allocation/suggest';
import { bookEntry } from '../src/ledger/finalize';
import { openItemsAtInternal } from '../src/ledger/open-items';
import { financeCategories, financeExpenseClaims, financeExpensePositions, financeImportRules, financeOpenItems } from '../src/schema';
import { approverCtx, enableExpenseWaivers, EXPENSE_IBAN, expenseFixture, expenseSubmitted, type ExpenseFixture } from './expense-fixture';
import { allowHumanOnlyOverMcp } from './helpers';

/**
 * F8a Task 3 — die Freigabe: Warteschlange, Kategorievorschlag, freigeben
 * (offene Zahlung), ablehnen. Der Freigeber trägt nur `finance.approve` und
 * `finance.read` — die Freigabe legt den offenen Posten im Namen des Vorgangs
 * an, ohne Buchungsrecht. `finance.approve` nie für eigene Anträge (Spec 10.1).
 */
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

const categoryId = (f: ExpenseFixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!.id;

/** Beide Positionen mit Kategorie: Beleg → Zweckausgaben, Fahrt → Fahrtkosten. */
const categorized = (f: ExpenseFixture, claim: { positions: { id: string }[] }) => [
  { positionId: claim.positions[0]!.id, categoryId: f.programCosts.id },
  { positionId: claim.positions[1]!.id, categoryId: categoryId(f, 'travel') },
];

/** Vera (Rolle „Verwaltung“) und Otto tragen `finance.approve` über die Rolle — so kennt `listUserNamesWithPermission` sie. */
function approversByRole(f: ExpenseFixture) {
  const roleId = f.deps.db.select().from(schema.roles).all().find((r) => r.name === 'Verwaltung')!.id;
  f.deps.db.insert(schema.rolePermissions).values({ roleId, permissionKey: 'finance.approve' }).run();
  f.deps.db.insert(schema.userRoles).values({ userId: f.otto.userId, roleId }).run();
  return { otto: ctxWith(['finance.expensesSubmit', 'finance.approve', 'finance.read'], f.otto.userId) };
}

describe('listApprovals', () => {
  it("queues submitted claims oldest first without the approver's own", async () => {
    const f = await expenseFixture();
    const { otto } = approversByRole(f);
    const first = await expenseSubmitted(f);
    f.deps.clock.set('2026-09-05T09:00:00.000Z');
    const second = await expenseSubmitted(f, f.otto);
    f.deps.clock.set('2026-09-05T10:00:00.000Z');
    const third = await expenseSubmitted(f);

    const queue = unwrap(await listApprovals(f.deps, approverCtx(f), {}));
    expect(queue.total).toBe(3);
    expect(queue.items.map((i) => i.claimId)).toEqual([first.id, second.id, third.id]);
    expect(queue.items[0]).toEqual({ kind: 'expenseClaim', claimId: first.id, number: 'KE-2026-001', contactName: 'Hanna Helferin', totalCents: 1999 + 2520, submittedAt: '2026-09-05T08:00:00.000Z', waiver: false });
    expect(JSON.stringify(queue)).not.toContain(EXPENSE_IBAN);

    // Otto sieht seinen eigenen Antrag nicht.
    expect(unwrap(await listApprovals(f.deps, otto, {})).items.map((i) => i.claimId)).toEqual([first.id, third.id]);
    expect(unwrap(await listApprovals(f.deps, approverCtx(f), { limit: 1, offset: 1 }))).toMatchObject({ total: 3, items: [{ claimId: second.id }] });

    // Entschiedene verlassen die Schlange.
    unwrap(await rejectExpenseClaim(f.deps, approverCtx(f), { claimId: first.id, note: 'Beleg unleserlich' }));
    expect(unwrap(await listApprovals(f.deps, approverCtx(f), {})).items.map((i) => i.claimId)).toEqual([second.id, third.id]);
  });
});

describe('getApproval', () => {
  it('refuses the approver\'s own claim and the claim of his contact, naming who can', async () => {
    const f = await expenseFixture();
    const { otto } = approversByRole(f);
    const own = await expenseSubmitted(f, f.otto);
    for (const call of [getApproval(f.deps, otto, { claimId: own.id }), approveExpenseClaim(f.deps, otto, { claimId: own.id, positions: categorized(f, own) }), rejectExpenseClaim(f.deps, otto, { claimId: own.id, note: 'x' })]) {
      expect(err(await call)).toMatchObject({ type: 'conflict', code: 'expenseOwnClaim', message: expect.stringContaining('Vera Verwalterin') });
    }

    // Jemand anderes hat den Antrag für Ottos Kontakt angelegt — Otto bleibt die antragstellende Person.
    const id = newId();
    f.deps.db.insert(financeExpenseClaims).values({ id, contactId: f.otto.contactId, submittedByUserId: f.userId, state: 'draft', iban: EXPENSE_IBAN, createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z' }).run();
    const positionId = newId();
    f.deps.db.insert(financeExpensePositions).values({ id: positionId, claimId: id, sortOrder: 0, kind: 'receipt', positionDate: '2026-08-20', amountCents: 500, purpose: 'Futter', documentId: null }).run();
    f.deps.db.update(financeExpenseClaims).set({ state: 'submitted', number: 'KE-2026-099', submittedAt: '2026-09-05T08:00:00.000Z' }).where(eq(financeExpenseClaims.id, id)).run();
    const refused = await getApproval(f.deps, otto, { claimId: id });
    expect(err(refused)).toMatchObject({ code: 'expenseSameContact', message: expect.stringContaining('Vera Verwalterin') });
    expect(JSON.stringify(err(refused))).not.toContain('Otto');
    expect(err(await approveExpenseClaim(f.deps, otto, { claimId: id, positions: [{ positionId, categoryId: f.programCosts.id }] }))).toMatchObject({ code: 'expenseSameContact' });

    // Jemand anderes darf.
    expect(unwrap(await getApproval(f.deps, approverCtx(f), { claimId: own.id }))).toMatchObject({ id: own.id, iban: EXPENSE_IBAN, receiptsVisible: true });
  });

  it('shows the claim without iban and receipts to an approver without finance.read', async () => {
    const f = await expenseFixture();
    const claim = await expenseSubmitted(f);
    const view = unwrap(await getApproval(f.deps, ctxWith(['finance.approve'], f.secondPersonId), { claimId: claim.id }));
    expect(view).toMatchObject({ iban: null, ibanMasked: 'DE66 **** **** **** **78 90', receiptsVisible: false, totalCents: claim.totalCents });
    expect(view.positions[0]!.documentId).toBeNull();
    expect(err(await getApproval(f.deps, f.hanna.ctx, { claimId: claim.id }))).toMatchObject({ type: 'forbidden', permission: 'finance.approve' });
  });
});

describe('suggestExpenseCategories', () => {
  it('suggests a category by rule or by a similar finalized entry, never as a must', async () => {
    const f = await expenseFixture();
    const T = '2026-01-01T00:00:00.000Z';
    f.deps.db.insert(financeImportRules).values({ id: 'R-OFF', name: 'Alte Regel', sortOrder: 0, isActive: false, textContains: 'Futter', direction: 'out', categoryId: categoryId(f, 'travel'), createdAt: T, createdByUserId: f.userId, updatedAt: T }).run();
    f.deps.db.insert(financeImportRules).values({ id: 'R-FUTTER', name: 'Futterkauf', sortOrder: 1, isActive: true, textContains: 'Futter', direction: 'out', categoryId: f.programCosts.id, createdAt: T, createdByUserId: f.userId, updatedAt: T }).run();
    const travel = categoryId(f, 'travel');
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-02', text: 'Erstattung Tierarztfahrt Beispielstadt', moneyLines: [{ accountId: f.bank.id, amountCents: -900 }], allocationLines: [{ categoryId: travel, amountCents: -900 }] }));
    const later = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-05-02', text: 'Tierarztfahrt Musterstadt', moneyLines: [{ accountId: f.bank.id, amountCents: -1200 }], allocationLines: [{ categoryId: travel, amountCents: -1200 }] }));

    const claim = await expenseSubmitted(f);
    const suggestions = unwrap(await suggestExpenseCategories(f.deps, approverCtx(f), { claimId: claim.id }));
    expect(suggestions).toEqual([
      { positionId: claim.positions[0]!.id, categoryId: f.programCosts.id, reason: { kind: 'rule', ruleName: 'Futterkauf' } },
      { positionId: claim.positions[1]!.id, categoryId: travel, reason: { kind: 'similarEntry', entryNumber: later.number } },
    ]);
    // Nur ein Vorschlag: Die Positionen bleiben ohne Kategorie, bis ein Mensch freigibt.
    expect(unwrap(await getExpenseClaim(f.deps, approverCtx(f), { id: claim.id })).positions.map((p) => p.categoryId)).toEqual([null, null]);
    // Ohne Treffer kein Vorschlag.
    f.deps.db.update(financeImportRules).set({ isActive: false }).run();
    expect(unwrap(await suggestExpenseCategories(f.deps, approverCtx(f), { claimId: claim.id })).map((s) => s.positionId)).toEqual([claim.positions[1]!.id]);
    expect(err(await suggestExpenseCategories(f.deps, f.hanna.ctx, { claimId: claim.id }))).toMatchObject({ type: 'forbidden', permission: 'finance.approve' });
  });
});

describe('approveExpenseClaim', () => {
  it('approves with categories and creates the payable open item with reference, contact, template and origin', async () => {
    const f = await expenseFixture();
    const claim = await expenseSubmitted(f);
    const approved = unwrap(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, expectedVersion: claim.version, positions: [...categorized(f, claim).slice(0, 1), { positionId: claim.positions[1]!.id, categoryId: categoryId(f, 'travel'), purposeId: f.abroadPurpose.id }] }));
    expect(approved).toMatchObject({ state: 'approved', stateLabelKey: 'approved', approvedAt: '2026-09-05T08:00:00.000Z', approvedByUserId: f.secondPersonId, entryId: null, paid: { settledCents: 0, state: 'unpaid' } });
    expect(approved.positions.map((p) => [p.categoryId, p.purposeId])).toEqual([[f.programCosts.id, null], [categoryId(f, 'travel'), f.abroadPurpose.id]]);

    const item = f.deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, approved.openItemId!)).get()!;
    expect(item).toMatchObject({ kind: 'payable', itemDate: '2026-09-05', dueOn: '2026-09-19', contactId: f.hanna.contactId, amountCents: 1999 + 2520, paymentReference: 'KE-2026-001', originType: 'financeExpenseClaim', originId: claim.id, documentId: null, createdByUserId: f.secondPersonId });
    expect(JSON.parse(item.lineTemplate!)).toEqual([
      { categoryId: f.programCosts.id, amountCents: -1999, taxCode: 'none', projectId: null, purposeId: null },
      { categoryId: categoryId(f, 'travel'), amountCents: -2520, taxCode: 'none', projectId: null, purposeId: f.abroadPurpose.id },
    ]);
    // Prüfstein 4: freigegeben, noch nicht ausgezahlt — zum Stichtag eine Verbindlichkeit.
    expect(openItemsAtInternal(f.deps.db, '2026-09-05')).toEqual([{ id: item.id, kind: 'payable', openCents: 1999 + 2520 }]);
    expect(openItemsAtInternal(f.deps.db, '2026-09-04')).toEqual([]);

    const log = JSON.parse(auditEntry(f.deps, 'finance.expenseClaim.approve').after as string);
    expect(log).toEqual({ state: 'approved', number: 'KE-2026-001', positionCount: 2, totalCents: 1999 + 2520, waiver: false, recurring: false, approvedAt: '2026-09-05T08:00:00.000Z', openItemId: item.id, channel: 'ui' });
  });

  it('approves exactly once under two concurrent approvals', async () => {
    const f = await expenseFixture();
    const claim = await expenseSubmitted(f);
    const results = await Promise.all([
      approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: categorized(f, claim) }),
      approveExpenseClaim(f.deps, ctxWith(['finance.approve', 'finance.read'], f.userId), { claimId: claim.id, positions: categorized(f, claim) }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(err(results.find((r) => !r.ok)!)).toMatchObject({ code: 'expenseNotSubmitted' });
    expect(f.deps.db.select().from(financeOpenItems).all()).toHaveLength(1);
    // Am Dienst vorbei: `state` verlässt `submitted` genau einmal (Trigger).
    expect(() => f.deps.db.update(financeExpenseClaims).set({ state: 'rejected' }).where(eq(financeExpenseClaims.id, claim.id)).run()).toThrow(/permanent/);
  });

  it('refuses without a category on every position', async () => {
    const f = await expenseFixture();
    const claim = await expenseSubmitted(f);
    const approver = approverCtx(f);
    expect(err(await approveExpenseClaim(f.deps, approver, { claimId: claim.id, positions: categorized(f, claim).slice(0, 1) }))).toMatchObject({ code: 'expenseCategoryRequired', message: expect.stringContaining('Position 2') });
    expect(err(await approveExpenseClaim(f.deps, approver, { claimId: claim.id, positions: [...categorized(f, claim).slice(0, 1), { positionId: claim.positions[1]!.id, categoryId: f.donations.id }] }))).toMatchObject({
      type: 'validation', issues: [{ path: 'positions.1.categoryId', message: 'notAnExpenseCategory' }],
    });
    expect(err(await approveExpenseClaim(f.deps, approver, { claimId: claim.id, positions: [...categorized(f, claim), { positionId: 'X', categoryId: f.programCosts.id }] }))).toMatchObject({ type: 'validation' });
    expect(err(await approveExpenseClaim(f.deps, approver, { claimId: claim.id, expectedVersion: '2026-01-01T00:00:00.000Z', positions: categorized(f, claim) }))).toMatchObject({ code: 'staleVersion' });
    expect(f.deps.db.select().from(financeOpenItems).all()).toEqual([]);
    expect(unwrap(await getExpenseClaim(f.deps, approver, { id: claim.id }))).toMatchObject({ state: 'submitted', positions: [{ categoryId: null }, { categoryId: null }] });
  });

  it('human only for approve over mcp', async () => {
    const f = await expenseFixture();
    const claim = await expenseSubmitted(f);
    const agent = { ...approverCtx(f), channel: 'mcp' as const };
    expect(err(await approveExpenseClaim(f.deps, agent, { claimId: claim.id, positions: categorized(f, claim) }))).toMatchObject({ code: 'humanOnly' });
    allowHumanOnlyOverMcp(f.deps);
    expect(unwrap(await approveExpenseClaim(f.deps, agent, { claimId: claim.id, positions: categorized(f, claim) })).state).toBe('approved');
  });

  it('refuses approving a waiver claim whose basis is empty — a safety net for old data (Befund 8)', async () => {
    const f = await expenseFixture();
    enableExpenseWaivers(f);
    // Ein Altbestand aus der Zeit vor dieser Prüfung: einreichen ohne Grundlage wird seit Befund 8 abgelehnt,
    // also lässt es sich nicht mehr über den Dienst nachstellen — der Antrag steht direkt in der Datenbank,
    // wie ein "submitted" aus der Zeit vor der Regel. `waiver`/`waiver_basis_text` sind nach dem Einreichen
    // unveränderlich (Trigger), ein UPDATE ginge also ohnehin nicht.
    const now = '2026-09-01T08:00:00.000Z';
    const claimId = newId();
    const positionId = newId();
    // Zuerst als Entwurf anlegen (Trigger erlauben dort noch Positionen und den Wechsel nach "submitted"),
    // dann festschreiben — waiver/waiverBasisText sind ab "submitted" unveraenderlich, ein direktes Einfuegen
    // als "submitted" wuerde die Positionen-Trigger sperren.
    f.deps.db
      .insert(financeExpenseClaims)
      .values({ id: claimId, number: null, contactId: f.hanna.contactId, submittedByUserId: f.hanna.userId, state: 'draft', iban: null, waiver: true, waiverBasisText: null, createdAt: now, updatedAt: now })
      .run();
    f.deps.db.insert(financeExpensePositions).values({ id: positionId, claimId, sortOrder: 0, kind: 'receipt', positionDate: '2025-06-01', amountCents: 1000, purpose: 'Altbestand', documentId: null }).run();
    f.deps.db.update(financeExpenseClaims).set({ state: 'submitted', number: 'KE-2025-999', submittedAt: now }).where(eq(financeExpenseClaims.id, claimId)).run();

    expect(err(await approveExpenseClaim(f.deps, approverCtx(f), { claimId, positions: [{ positionId, categoryId: f.programCosts.id }] }))).toMatchObject({ code: 'waiverBasisMissing' });
  });
});

describe('rejectExpenseClaim', () => {
  it('rejects with a note kept out of the log', async () => {
    const f = await expenseFixture();
    const claim = await expenseSubmitted(f);
    const agent = { ...approverCtx(f), channel: 'mcp' as const };
    expect(err(await rejectExpenseClaim(f.deps, agent, { claimId: claim.id, note: '  ' }))).toMatchObject({ type: 'validation' });
    // Ablehnen ist nicht humanOnly.
    const rejected = unwrap(await rejectExpenseClaim(f.deps, agent, { claimId: claim.id, note: 'Beleg unleserlich, bitte neu scannen' }));
    expect(rejected).toMatchObject({ state: 'rejected', stateLabelKey: 'rejected', rejectNote: 'Beleg unleserlich, bitte neu scannen', rejectedByUserId: f.secondPersonId, rejectedAt: '2026-09-05T08:00:00.000Z' });
    expect(unwrap(await getExpenseClaim(f.deps, f.hanna.ctx, { id: claim.id })).rejectNote).toBe('Beleg unleserlich, bitte neu scannen');
    expect(err(await rejectExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, note: 'nochmal' }))).toMatchObject({ code: 'expenseNotSubmitted' });
    expect(err(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: categorized(f, claim) }))).toMatchObject({ code: 'expenseNotSubmitted' });

    expect(JSON.parse(auditEntry(f.deps, 'finance.expenseClaim.reject').after as string)).toEqual({ state: 'rejected', number: 'KE-2026-001', rejected: true, channel: 'mcp' });
    expect(JSON.stringify(f.deps.db.select().from(schema.auditLog).all())).not.toContain('unleserlich');
  });
});

describe('forbidden, validation, audit', () => {
  it('forbidden/validation/audit', async () => {
    const f = await expenseFixture();
    const claim = await expenseSubmitted(f);
    for (const call of [
      listApprovals(f.deps, f.hanna.ctx, {}),
      getApproval(f.deps, f.hanna.ctx, { claimId: claim.id }),
      suggestExpenseCategories(f.deps, f.hanna.ctx, { claimId: claim.id }),
      approveExpenseClaim(f.deps, f.hanna.ctx, { claimId: claim.id, positions: categorized(f, claim) }),
      rejectExpenseClaim(f.deps, f.hanna.ctx, { claimId: claim.id, note: 'x' }),
    ]) {
      expect(err(await call)).toMatchObject({ type: 'forbidden', permission: 'finance.approve' });
    }
    expect(err(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id }))).toMatchObject({ type: 'validation' });
    expect(err(await listApprovals(f.deps, approverCtx(f), { limit: 0 }))).toMatchObject({ type: 'validation' });
    expect(err(await getApproval(f.deps, approverCtx(f), { claimId: 'NOPE' }))).toMatchObject({ type: 'notFound' });

    unwrap(await approveExpenseClaim(f.deps, approverCtx(f), { claimId: claim.id, positions: categorized(f, claim) }));
    const positionLog = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.expensePosition.categorize');
    expect(positionLog.map((a) => JSON.parse(a.after as string))).toEqual([
      { claimId: claim.id, categoryId: f.programCosts.id, purposeId: null, projectId: null },
      { claimId: claim.id, categoryId: categoryId(f, 'travel'), purposeId: null, projectId: null },
    ]);
    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action.startsWith('finance.')));
    for (const secret of [EXPENSE_IBAN, f.hanna.contactId, 'Futter', 'Tierarztfahrt', 'Hanna']) expect(log, secret).not.toContain(secret);
  });
});
