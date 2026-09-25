import { newId } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { installFinance } from '../src/install';
import { financeCategories, financeContactWaiverTerms, financeExpenseClaims, financeExpenseCounters, financeExpensePositions } from '../src/schema';
import { setupFinance } from './helpers';

/**
 * Der mechanische Wächter der Auslagen-Tabellen (F8a Task 1): jede Regel aus
 * dem Plan gegen die echte Datenbank, roh über Drizzle — Muster
 * `donations-schema.test.ts`. Die Dienste (Task 2/3) prüfen die Fachregeln;
 * die Trigger fangen, was an ihnen vorbeigeht.
 */
type Deps = ReturnType<typeof setupFinance>['deps'];

function insertClaim(deps: Deps, o: Partial<typeof financeExpenseClaims.$inferInsert> = {}) {
  const id = o.id ?? newId();
  deps.db
    .insert(financeExpenseClaims)
    .values({ id, contactId: 'CONTACT-1', submittedByUserId: 'U1', state: 'draft', iban: 'DE23999999990000202051', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z', ...o })
    .run();
  return id;
}

function insertPosition(deps: Deps, claimId: string, o: Partial<typeof financeExpensePositions.$inferInsert> = {}) {
  const id = o.id ?? newId();
  deps.db
    .insert(financeExpensePositions)
    .values({ id, claimId, sortOrder: 0, kind: 'receipt', positionDate: '2026-02-20', amountCents: 2520, purpose: 'Futter für die Pflegestelle', documentId: 'DOC-1', documentNumber: 'ERE-2026-0001', ...o })
    .run();
  return id;
}

const updateClaim = (deps: Deps, id: string, set: Partial<typeof financeExpenseClaims.$inferInsert>) => deps.db.update(financeExpenseClaims).set(set).where(eq(financeExpenseClaims.id, id)).run();
const updatePosition = (deps: Deps, id: string, set: Partial<typeof financeExpensePositions.$inferInsert>) => deps.db.update(financeExpensePositions).set(set).where(eq(financeExpensePositions.id, id)).run();

/** Ein eingereichter Antrag mit einer Position — der Übergang aus dem Entwurf, wie ihn `submitExpenseClaim` schreibt. */
function submitted(deps: Deps) {
  const id = insertClaim(deps);
  const positionId = insertPosition(deps, id);
  updateClaim(deps, id, { state: 'submitted', number: 'KE-2026-001', submittedAt: '2026-03-02T10:00:00.000Z' });
  return { id, positionId };
}

describe('finance_expense_claims', () => {
  it('has the columns of the plan, a draft without number, and the approval fields empty', () => {
    const { deps } = setupFinance();
    const id = insertClaim(deps);
    expect(deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, id)).get()).toEqual({
      id, number: null, contactId: 'CONTACT-1', submittedByUserId: 'U1', state: 'draft', iban: 'DE23999999990000202051', waiver: false, recurring: false,
      waiverBasisText: null, waiverAgreedOn: null, waiverDeclaredOn: null, waiverDeclarationDocumentId: null, waiverSignedDocumentId: null, claimAgreedConfirmed: false,
      waiverLateReason: null, waiverFreeFundsCents: null, submittedAt: null, approvedAt: null, approvedByUserId: null, rejectedAt: null, rejectedByUserId: null, rejectNote: null,
      openItemId: null, entryId: null, copiedFromClaimId: null, createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
    });
  });

  it('carries a number at most once', () => {
    const { deps } = setupFinance();
    insertClaim(deps, { state: 'submitted', number: 'KE-2026-001' });
    expect(() => insertClaim(deps, { state: 'submitted', number: 'KE-2026-001' })).toThrow(/UNIQUE/);
    insertClaim(deps);
    insertClaim(deps);
  });

  it('points a copy at an existing claim', () => {
    const { deps } = setupFinance();
    expect(() => insertClaim(deps, { copiedFromClaimId: 'NO-SUCH-CLAIM' })).toThrow(/FOREIGN KEY/);
    insertClaim(deps, { copiedFromClaimId: insertClaim(deps) });
  });

  it('a draft stays changeable and deletable, and leaves the draft only towards submitted', () => {
    const { deps } = setupFinance();
    const id = insertClaim(deps);
    updateClaim(deps, id, { iban: null, waiver: true, recurring: true });
    for (const state of ['approved', 'rejected'] as const) expect(() => updateClaim(deps, id, { state }), state).toThrow(/draft/);
    deps.db.delete(financeExpenseClaims).where(eq(financeExpenseClaims.id, id)).run();
    expect(deps.db.select().from(financeExpenseClaims).all()).toEqual([]);
  });

  it('is never deleted once submitted', () => {
    const { deps } = setupFinance();
    const { id } = submitted(deps);
    expect(() => deps.db.delete(financeExpenseClaims).where(eq(financeExpenseClaims.id, id)).run()).toThrow(/permanent/);
  });

  it('never changes what was submitted', () => {
    const { deps } = setupFinance();
    const { id } = submitted(deps);
    for (const change of [
      { number: 'KE-2026-002' }, { contactId: 'OTHER' }, { submittedByUserId: 'U2' }, { iban: 'DE66999999991234567890' }, { waiver: true }, { recurring: true },
      { waiverBasisText: 'Satzung § 9' }, { waiverAgreedOn: '2026-01-01' }, { submittedAt: '2026-03-03T10:00:00.000Z' }, { copiedFromClaimId: id }, { createdAt: 'x' }, { state: 'draft' as const },
    ]) {
      expect(() => updateClaim(deps, id, change), JSON.stringify(change)).toThrow(/permanent/);
    }
  });

  it('takes the approval fields while submitted, and leaves submitted exactly once', () => {
    const { deps } = setupFinance();
    const { id } = submitted(deps);
    updateClaim(deps, id, {
      claimAgreedConfirmed: true, waiverDeclaredOn: '2026-03-05', waiverDeclarationDocumentId: 'DOC-VZE', waiverLateReason: 'Urlaub', waiverFreeFundsCents: 100000, updatedAt: '2026-03-05T10:00:00.000Z',
    });
    updateClaim(deps, id, { state: 'approved', approvedAt: '2026-03-06T10:00:00.000Z', approvedByUserId: 'U2', entryId: null, openItemId: null });
    for (const change of [{ state: 'rejected' as const }, { state: 'submitted' as const }, { approvedAt: 'x' }, { approvedByUserId: 'U3' }, { rejectNote: 'doch nicht' }, { waiverFreeFundsCents: 1 }, { claimAgreedConfirmed: false }, { waiverDeclaredOn: '2026-03-07' }, { waiverDeclarationDocumentId: 'DOC-X' }]) {
      expect(() => updateClaim(deps, id, change), JSON.stringify(change)).toThrow(/permanent/);
    }
  });

  it('a rejected claim stays rejected with its note', () => {
    const { deps } = setupFinance();
    const { id } = submitted(deps);
    updateClaim(deps, id, { state: 'rejected', rejectedAt: '2026-03-06T10:00:00.000Z', rejectedByUserId: 'U2', rejectNote: 'Beleg unleserlich' });
    for (const change of [{ state: 'approved' as const }, { rejectNote: 'anders' }, { rejectedAt: null }]) {
      expect(() => updateClaim(deps, id, change), JSON.stringify(change)).toThrow(/permanent/);
    }
  });

  it('takes the signed waiver once, also after approval; a deleted document leaves the field empty', () => {
    const { deps } = setupFinance();
    const { id } = submitted(deps);
    updateClaim(deps, id, { waiverDeclarationDocumentId: 'DOC-VZE', state: 'approved', approvedAt: '2026-03-06T10:00:00.000Z', approvedByUserId: 'U2' });
    updateClaim(deps, id, { waiverSignedDocumentId: 'DOC-VZU' });
    expect(() => updateClaim(deps, id, { waiverSignedDocumentId: 'DOC-OTHER' })).toThrow(/permanent/);
    // Grabstein: Das Löschen des Dokuments nach seiner Frist leert nur die ID (`recordDeleted`).
    updateClaim(deps, id, { waiverSignedDocumentId: null, waiverDeclarationDocumentId: null });
  });
});

describe('finance_expense_positions', () => {
  it('has the columns of the plan and belongs to an existing claim', () => {
    const { deps } = setupFinance();
    const claimId = insertClaim(deps);
    const id = insertPosition(deps, claimId, { kind: 'trip', documentId: null, documentNumber: null, tripFrom: 'Musterstadt', tripTo: 'Beispielhausen', tripReason: 'Vorkontrolle', tripKm: 84, tripRateCentsPerKm: 30 });
    expect(deps.db.select().from(financeExpensePositions).where(eq(financeExpensePositions.id, id)).get()).toEqual({
      id, claimId, sortOrder: 0, kind: 'trip', positionDate: '2026-02-20', amountCents: 2520, purpose: 'Futter für die Pflegestelle', projectId: null, documentId: null, documentNumber: null,
      tripFrom: 'Musterstadt', tripTo: 'Beispielhausen', tripReason: 'Vorkontrolle', tripKm: 84, tripRateCentsPerKm: 30, categoryId: null, purposeId: null,
    });
    expect(() => insertPosition(deps, 'NO-SUCH-CLAIM')).toThrow(/FOREIGN KEY/);
  });

  it('accepts an incomplete position in a draft: no date, no amount, no purpose yet', () => {
    const { deps } = setupFinance();
    const claimId = insertClaim(deps);
    const id = newId();
    deps.db.insert(financeExpensePositions).values({ id, claimId, sortOrder: 0, kind: 'receipt' }).run();
    expect(deps.db.select().from(financeExpensePositions).where(eq(financeExpensePositions.id, id)).get()).toMatchObject({ positionDate: null, amountCents: 0, purpose: '' });
  });

  it('stays changeable, insertable and deletable while the claim is a draft', () => {
    const { deps } = setupFinance();
    const claimId = insertClaim(deps);
    const id = insertPosition(deps, claimId);
    updatePosition(deps, id, { amountCents: 1999, purpose: 'Tierarzt', documentId: 'DOC-2', documentNumber: 'ERE-2026-0002' });
    insertPosition(deps, claimId, { sortOrder: 1 });
    deps.db.delete(financeExpensePositions).where(eq(financeExpensePositions.claimId, claimId)).run();
  });

  it('after submission only category and purpose change, while the claim is submitted — nothing is added or removed', () => {
    const { deps } = setupFinance();
    const { id: claimId, positionId } = submitted(deps);
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const categoryId = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'bank-fees')).get()!.id;
    updatePosition(deps, positionId, { categoryId, purposeId: null });
    for (const change of [{ amountCents: 1 }, { purpose: 'anders' }, { positionDate: '2026-02-21' }, { kind: 'trip' as const }, { tripKm: 1 }, { documentId: 'DOC-OTHER' }, { documentNumber: 'X' }, { projectId: 'P1' }, { sortOrder: 3 }]) {
      expect(() => updatePosition(deps, positionId, change), JSON.stringify(change)).toThrow(/permanent/);
    }
    expect(() => insertPosition(deps, claimId, { sortOrder: 1 })).toThrow(/permanent/);
    expect(() => deps.db.delete(financeExpensePositions).where(eq(financeExpensePositions.id, positionId)).run()).toThrow(/permanent/);
  });

  it('after approval nothing changes but the gravestone of a deleted receipt', () => {
    const { deps } = setupFinance();
    const { id: claimId, positionId } = submitted(deps);
    updateClaim(deps, claimId, { state: 'approved', approvedAt: '2026-03-06T10:00:00.000Z', approvedByUserId: 'U2' });
    expect(() => updatePosition(deps, positionId, { purposeId: 'PURPOSE-X' })).toThrow(/permanent/);
    expect(() => updatePosition(deps, positionId, { categoryId: 'CAT-X' })).toThrow(/permanent/);
    updatePosition(deps, positionId, { documentId: null });
    expect(deps.db.select().from(financeExpensePositions).where(eq(financeExpensePositions.id, positionId)).get()).toMatchObject({ documentId: null, documentNumber: 'ERE-2026-0001' });
  });

  it('points category and purpose at existing ones of the module', () => {
    const { deps } = setupFinance();
    const claimId = insertClaim(deps);
    expect(() => insertPosition(deps, claimId, { categoryId: 'NO-SUCH-CATEGORY' })).toThrow(/FOREIGN KEY/);
    expect(() => insertPosition(deps, claimId, { purposeId: 'NO-SUCH-PURPOSE' })).toThrow(/FOREIGN KEY/);
  });
});

describe('finance_expense_counters and finance_contact_waiver_terms', () => {
  it('counts per year of submission', () => {
    const { deps } = setupFinance();
    deps.db.insert(financeExpenseCounters).values({ year: 2026, last: 12 }).run();
    expect(() => deps.db.insert(financeExpenseCounters).values({ year: 2026, last: 1 }).run()).toThrow(/UNIQUE|PRIMARY/);
    expect(deps.db.select().from(financeExpenseCounters).all()).toEqual([{ year: 2026, last: 12 }]);
  });

  it('keeps one waiver agreement per contact, overridable', () => {
    const { deps } = setupFinance();
    deps.db.insert(financeContactWaiverTerms).values({ id: 'WT1', contactId: 'CONTACT-1', basisText: 'Vereinbarung vom 02.01.2026', agreedOn: '2026-01-02', updatedAt: '2026-01-02T10:00:00.000Z', updatedByUserId: 'U1' }).run();
    expect(() => deps.db.insert(financeContactWaiverTerms).values({ id: 'WT2', contactId: 'CONTACT-1', basisText: 'x', agreedOn: '2026-01-03', updatedAt: 'x', updatedByUserId: 'U1' }).run()).toThrow(/UNIQUE/);
    deps.db.update(financeContactWaiverTerms).set({ basisText: 'Satzung § 9 Abs. 2', agreedOn: '2026-02-01' }).where(eq(financeContactWaiverTerms.contactId, 'CONTACT-1')).run();
  });
});
