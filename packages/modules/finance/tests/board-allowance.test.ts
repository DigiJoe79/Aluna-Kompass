import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { addContactRole } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { setBoardRemuneration } from '../src/ledger/setup';
import { financeCategories } from '../src/schema';
import { expenseFixture, type ExpenseFixture } from './expense-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const volunteer = (f: ExpenseFixture) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'volunteer-allowance')).get()!;

async function boardFixture() {
  const f = await expenseFixture();
  unwrap(await addContactRole(f.deps, ctxWith(['contacts.manage'], f.userId), { id: f.hanna.contactId, role: 'board-member', since: '2026-01-01' }));
  const allowance = (o: { date?: string; contactId?: string; reason?: string; categoryId?: string } = {}) => ({
    entryDate: o.date ?? '2026-03-01', text: 'Ehrenamtspauschale',
    moneyLines: [{ accountId: f.bank.id, amountCents: -20000 }],
    allocationLines: [{ categoryId: o.categoryId ?? volunteer(f).id, amountCents: -20000, contactId: o.contactId ?? f.hanna.contactId }],
    ...(o.reason !== undefined ? { reason: o.reason } : {}),
  });
  return { ...f, allowance };
}

describe('allowance to a board member without basis (AH)', () => {
  it('booking asks for a reason; with one it books and keeps the reason at the entry, never in the log', async () => {
    const f = await boardFixture();
    expect(err(await bookEntry(f.deps, f.ctx, f.allowance()))).toMatchObject({ type: 'conflict', code: 'boardAllowanceNeedsReason' });
    const booked = unwrap(await bookEntry(f.deps, f.ctx, f.allowance({ reason: 'Satzungsänderung beantragt, Beschluss folgt' })));
    expect(booked).toMatchObject({ status: 'final', boardAllowanceReason: 'Satzungsänderung beantragt, Beschluss folgt' });
    expect(JSON.stringify(f.deps.db.select().from(schema.auditLog).all())).not.toContain('Satzungsänderung');
  });

  it('saving a draft asks too, and finalizing a draft without a reason is refused', async () => {
    const f = await boardFixture();
    expect(err(await saveDraft(f.deps, f.ctx, f.allowance()))).toMatchObject({ type: 'conflict', code: 'boardAllowanceNeedsReason' });
    const draft = unwrap(await saveDraft(f.deps, f.ctx, f.allowance({ reason: 'Vorab mit Steuerberatung geklärt' })));
    expect(unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id })).boardAllowanceReason).toBe('Vorab mit Steuerberatung geklärt');

    // Der Entwurf entstand, bevor Otto Vorstand wurde — beim Festschreiben zählt die Lage am Buchungstag.
    const early = unwrap(await saveDraft(f.deps, f.ctx, f.allowance({ contactId: f.otto.contactId })));
    unwrap(await addContactRole(f.deps, ctxWith(['contacts.manage'], f.userId), { id: f.otto.contactId, role: 'board-member', since: '2026-02-01' }));
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: early.id }))).toMatchObject({ type: 'conflict', code: 'boardAllowanceNeedsReason' });
  });

  it('asks nothing with a basis in force on the day, for a non-member, or for a category without allowance', async () => {
    const f = await boardFixture();
    unwrap(await bookEntry(f.deps, f.ctx, f.allowance({ contactId: f.otto.contactId })));
    unwrap(await bookEntry(f.deps, f.ctx, f.allowance({ categoryId: f.programCosts.id })));
    unwrap(await setBoardRemuneration(f.deps, f.ctx, { allowed: true, basisText: 'Satzung § 12', validFrom: '2026-02-01' }));
    unwrap(await bookEntry(f.deps, f.ctx, f.allowance({ date: '2026-02-01' })));
    // Vor dem Tag der Grundlage trägt sie nicht (AK).
    expect(err(await bookEntry(f.deps, f.ctx, f.allowance({ date: '2026-01-15' })))).toMatchObject({ type: 'conflict', code: 'boardAllowanceNeedsReason' });
  });
});
