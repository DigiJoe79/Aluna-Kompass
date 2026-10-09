import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { addContactRole, contactRoles, endContactRole } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approveExpenseClaim } from '../src/allocation/approvals';
import { attachSignedWaiver, createWaiverDeclaration } from '../src/allocation/waiver';
import { approverCtx, enableExpenseWaivers, expenseFixture, expenseSubmitted, type ExpenseFixture } from './expense-fixture';
import { personYearOverview, relatedPartyPayments } from '../src/allocation/people';
import { setBoardRemuneration } from '../src/ledger/setup';
import { bookEntry } from '../src/ledger/finalize';
import { financeCategories } from '../src/schema';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const contactsManage = (f: ExpenseFixture) => ctxWith(['contacts.manage'], f.userId);
const overviewOnly = (f: ExpenseFixture) => ctxWith(['finance.overview'], f.userId);

function categoryByKey(deps: ExpenseFixture['deps'], key: string) {
  return deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
}

/** Ein freigegebener Antrag Hannas, beide Positionen auf `f.programCosts`. */
async function approvedClaim(f: ExpenseFixture) {
  const claim = await expenseSubmitted(f);
  return unwrap(
    await approveExpenseClaim(f.deps, approverCtx(f), {
      claimId: claim.id,
      expectedVersion: claim.version,
      positions: claim.positions.map((p) => ({ positionId: p.id, categoryId: f.programCosts.id })),
    }),
  );
}

describe('personYearOverview (F8b Task 4, Annahme 9, § 3 Nr. 26/26a EStG)', () => {
  it('sums allowances per person and calendar year from finalized lines only, never counting an allowance line as reimbursement', async () => {
    const f = await expenseFixture();
    const volunteer = categoryByKey(f.deps, 'volunteer-allowance');
    const trainer = categoryByKey(f.deps, 'trainer-allowance');
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Ehrenamtspauschale', moneyLines: [{ accountId: f.bank.id, amountCents: -50000 }], allocationLines: [{ categoryId: volunteer.id, amountCents: -50000, contactId: f.hanna.contactId }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Übungsleiterpauschale', moneyLines: [{ accountId: f.bank.id, amountCents: -30000 }], allocationLines: [{ categoryId: trainer.id, amountCents: -30000, contactId: f.hanna.contactId }] }));
    const overview = unwrap(await personYearOverview(f.deps, f.ctx, { year: 2026 }));
    const row = overview.rows.find((r) => r.contactId === f.hanna.contactId)!;
    expect(row).toMatchObject({ allowanceVolunteerCents: 50000, allowanceTrainerCents: 30000, reimbursementCents: 0, allowanceVolunteerCapCents: 96000, allowanceTrainerCapCents: 330000 });

    // Ein anderes Kalenderjahr ohne Buchung zählt nichts — nie das Vorjahr mitrechnen.
    const overview2025 = unwrap(await personYearOverview(f.deps, f.ctx, { year: 2025 }));
    expect(overview2025.rows.find((r) => r.contactId === f.hanna.contactId)).toBeUndefined();
  });

  it('counts reimbursements as non-allowance lines settling expense-claim items, grouped by contact', async () => {
    const f = await expenseFixture();
    const approved = await approvedClaim(f);
    expect(approved.openItemId).not.toBeNull();
    const total = approved.positions.reduce((s, p) => s + p.amountCents, 0);

    unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-08-25',
        text: 'Erstattung',
        moneyLines: [{ accountId: f.bank.id, amountCents: -total, settlements: [{ openItemId: approved.openItemId!, amountCents: total }] }],
        allocationLines: [{ categoryId: f.programCosts.id, amountCents: -total, contactId: f.hanna.contactId }],
      }),
    );

    const overview = unwrap(await personYearOverview(f.deps, f.ctx, { year: 2026 }));
    const row = overview.rows.find((r) => r.contactId === f.hanna.contactId)!;
    expect(row.reimbursementCents).toBe(total);
    expect(row.allowanceVolunteerCents).toBe(0);
    // D4 (Design-Nachtrag Phase 4): „Erstattungen 2026: … · 1 Antrag“.
    expect(row.reimbursementClaimCount).toBe(1);
  });

  it('AJ: a waived expense is no reimbursement — no money went to the person; it is shown apart as waived, even though its lines carry no contact', async () => {
    const f = await expenseFixture();
    enableExpenseWaivers(f);
    await f.finalEntry();
    const { financeContactWaiverTerms } = await import('../src/schema');
    f.deps.db.insert(financeContactWaiverTerms).values({ id: 'WT1', contactId: f.hanna.contactId, basisText: 'Vereinbarung', agreedOn: '2026-01-01', updatedAt: '2026-01-01T00:00:00.000Z', updatedByUserId: f.userId }).run();
    const claim = await expenseSubmitted(f, f.hanna, { waiver: true });
    unwrap(await createWaiverDeclaration(f.deps, approverCtx(f), { claimId: claim.id, declaredOn: '2026-09-05' }));
    unwrap(await attachSignedWaiver(f.deps, approverCtx(f), { claimId: claim.id, bytes: f.pdf() }));
    const approved = unwrap(
      await approveExpenseClaim(f.deps, approverCtx(f), {
        claimId: claim.id,
        positions: claim.positions.map((p) => ({ positionId: p.id, categoryId: f.programCosts.id })),
        waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-05' },
      }),
    );
    expect(approved.entryId).not.toBeNull();
    const total = approved.positions.reduce((s, p) => s + p.amountCents, 0);

    const overview = unwrap(await personYearOverview(f.deps, f.ctx, { year: 2026 }));
    expect(overview.rows.find((r) => r.contactId === f.hanna.contactId)).toMatchObject({ reimbursementCents: 0, waivedCents: total });
  });

  it('reports lines without a person as a count, and refuses without finance.read', async () => {
    const f = await expenseFixture();
    const volunteer = categoryByKey(f.deps, 'volunteer-allowance');
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Sammelpauschale', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: volunteer.id, amountCents: -5000 }] }));
    const overview = unwrap(await personYearOverview(f.deps, f.ctx, { year: 2026 }));
    expect(overview.linesWithoutPersonCount).toBe(1);

    const denied = await personYearOverview(f.deps, overviewOnly(f), { year: 2026 });
    expect(err(denied)).toMatchObject({ type: 'forbidden' });
  });
});

describe('relatedPartyPayments (E21, Annahme 10, Review Focus 6)', () => {
  it('says so when no contact holds a board-member role in the year — the list would stay silently empty (T)', async () => {
    const f = await expenseFixture();
    expect(unwrap(await relatedPartyPayments(f.deps, f.ctx, { fiscalYearId: f.year.id })).boardMembersMissing).toBe(true);
    unwrap(await addContactRole(f.deps, contactsManage(f), { id: f.hanna.contactId, role: 'board-member', since: '2026-01-01' }));
    expect(unwrap(await relatedPartyPayments(f.deps, f.ctx, { fiscalYearId: f.year.id })).boardMembersMissing).toBe(false);
  });

  it('names the approver for claims with an item', async () => {
    const f = await expenseFixture();
    unwrap(await addContactRole(f.deps, contactsManage(f), { id: f.hanna.contactId, role: 'board-member', since: '2026-01-01' }));
    const approved = await approvedClaim(f);
    const total = approved.positions.reduce((s, p) => s + p.amountCents, 0);

    unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-02-10',
        text: 'Auslage an Vorstand',
        moneyLines: [{ accountId: f.bank.id, amountCents: -total, settlements: [{ openItemId: approved.openItemId!, amountCents: total }] }],
        allocationLines: [{ categoryId: f.programCosts.id, amountCents: -total, contactId: f.hanna.contactId }],
      }),
    );

    const rows = unwrap(await relatedPartyPayments(f.deps, f.ctx, { fiscalYearId: f.year.id })).rows;
    const row = rows.find((r) => r.amountCents === total)!;
    expect(row).toMatchObject({ role: 'board-member', approvedByUserId: approved.approvedByUserId });
    // E21 „Art“ (Design 4f): die Herkunft der Zahlung mit ihrer Nummer, nicht nur die Kategorie.
    expect(row).toMatchObject({ originKind: 'expenseClaim', originNumber: approved.number });
    expect(approved.number).toBeTruthy();
  });

  it('a board-member role that ends in the year excludes lines after its end (Review Focus 6)', async () => {
    const f = await expenseFixture();
    unwrap(await addContactRole(f.deps, contactsManage(f), { id: f.hanna.contactId, role: 'board-member', since: '2026-01-01' }));
    const role = f.deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, f.hanna.contactId)).get()!;
    unwrap(await endContactRole(f.deps, contactsManage(f), { roleId: role.id, until: '2026-06-30' }));

    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-08-01', text: 'Nach dem Amtsende', moneyLines: [{ accountId: f.bank.id, amountCents: -1000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1000, contactId: f.hanna.contactId }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Während des Amts', moneyLines: [{ accountId: f.bank.id, amountCents: -1000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1000, contactId: f.hanna.contactId }] }));

    const rows = unwrap(await relatedPartyPayments(f.deps, f.ctx, { fiscalYearId: f.year.id })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entryDate).toBe('2026-03-01');
  });

  it('warns on an allowance to a board member without a confirmed setup point; confirming removes the warning', async () => {
    const f = await expenseFixture();
    unwrap(await addContactRole(f.deps, contactsManage(f), { id: f.hanna.contactId, role: 'board-member', since: '2026-01-01' }));
    const volunteer = categoryByKey(f.deps, 'volunteer-allowance');
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Ehrenamtspauschale an Vorstand', moneyLines: [{ accountId: f.bank.id, amountCents: -1000 }], allocationLines: [{ categoryId: volunteer.id, amountCents: -1000, contactId: f.hanna.contactId }], reason: 'Grundlage folgt' }));

    const before = unwrap(await relatedPartyPayments(f.deps, f.ctx, { fiscalYearId: f.year.id })).rows;
    expect(before[0]!.boardAllowanceWithoutBasis).toBe(true);

    unwrap(await setBoardRemuneration(f.deps, f.ctx, { allowed: true, basisText: 'Satzung § 12', validFrom: '2026-01-01' }));
    const after = unwrap(await relatedPartyPayments(f.deps, f.ctx, { fiscalYearId: f.year.id })).rows;
    expect(after[0]!.boardAllowanceWithoutBasis).toBe(false);
  });

  it('Befund AK: the basis applies from its date — a payment before it keeps the mark, one on or after loses it', async () => {
    const f = await expenseFixture();
    unwrap(await addContactRole(f.deps, contactsManage(f), { id: f.hanna.contactId, role: 'board-member', since: '2026-01-01' }));
    const volunteer = categoryByKey(f.deps, 'volunteer-allowance');
    const pay = (entryDate: string) => bookEntry(f.deps, f.ctx, { entryDate, text: 'Pauschale an Vorstand', moneyLines: [{ accountId: f.bank.id, amountCents: -1000 }], allocationLines: [{ categoryId: volunteer.id, amountCents: -1000, contactId: f.hanna.contactId }], reason: 'Grundlage folgt' });
    unwrap(await pay('2026-03-01'));
    unwrap(await pay('2026-05-01'));

    expect(await setBoardRemuneration(f.deps, f.ctx, { allowed: true, basisText: 'Satzung § 12' })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'validFrom', message: 'required' }] } });
    unwrap(await setBoardRemuneration(f.deps, f.ctx, { allowed: true, basisText: 'Satzung § 12', validFrom: '2026-05-01' }));
    const rows = unwrap(await relatedPartyPayments(f.deps, f.ctx, { fiscalYearId: f.year.id })).rows;
    expect(rows.map((r) => [r.entryDate, r.boardAllowanceWithoutBasis])).toEqual([['2026-03-01', true], ['2026-05-01', false]]);

    // Eine Grundlage von vor dem Datum (Bestand ohne `validFrom`) trägt keine Zahlung.
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.boardRemunerationValidFrom', null));
    expect(unwrap(await relatedPartyPayments(f.deps, f.ctx, { fiscalYearId: f.year.id })).rows.every((r) => r.boardAllowanceWithoutBasis)).toBe(true);
  });
});
