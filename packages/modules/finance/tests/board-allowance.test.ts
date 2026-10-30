import { readSetting, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { addContactRole } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { applyBoardRemunerationInternal, setBoardRemuneration } from '../src/ledger/setup';
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
  it('booking asks for a reason; with one it books and keeps the reason at the entry', async () => {
    const f = await boardFixture();
    expect(err(await bookEntry(f.deps, f.ctx, f.allowance()))).toMatchObject({ type: 'conflict', code: 'boardAllowanceNeedsReason' });
    const booked = unwrap(await bookEntry(f.deps, f.ctx, f.allowance({ reason: 'Satzungsänderung beantragt, Beschluss folgt' })));
    expect(booked).toMatchObject({ status: 'final', boardAllowanceReason: 'Satzungsänderung beantragt, Beschluss folgt' });
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

describe('board remuneration from a resolution (G7)', () => {
  it('applyBoardRemunerationInternal writes the six settings and audits the resolution, not the text', async () => {
    const f = await boardFixture();
    f.deps.db.transaction((tx) => applyBoardRemunerationInternal(tx, f.deps, f.ctx, { allowed: true, basisText: 'Satzung § 12', validFrom: '2026-02-01', documentId: null, decidedOn: '2026-01-20', resolutionId: 'R1' }));
    expect(['Allowed', 'BasisText', 'DocumentId', 'ValidFrom', 'DecidedOn', 'ResolutionId'].map((k) => readSetting(f.deps, `finance.boardRemuneration${k}`))).toEqual([true, 'Satzung § 12', null, '2026-02-01', '2026-01-20', 'R1']);
    const entry = auditEntry(f.deps, 'finance.setup.boardRemuneration');
    expect(JSON.parse(entry.params!)).toEqual({ resolutionId: 'R1' });
    expect(entry.after).not.toContain('Satzung');
    // Ohne Modul, das den Beschluss kennt (Gremien aus), bleibt die Vergütung von Hand pflegbar.
    expect((await setBoardRemuneration(f.deps, f.ctx, { allowed: false, basisText: '' })).ok).toBe(true);
    expect(readSetting(f.deps, 'finance.boardRemunerationResolutionId')).toBe('');
  });

  it('W-3: a later resolution keeps the earliest day of the continuous allowance; a payment in between keeps its basis', async () => {
    const f = await boardFixture();
    f.deps.db.transaction((tx) => applyBoardRemunerationInternal(tx, f.deps, f.ctx, { allowed: true, basisText: 'Satzung § 12', validFrom: '2026-02-01', documentId: null, decidedOn: '2026-01-20', resolutionId: 'R1' }));
    f.deps.db.transaction((tx) => applyBoardRemunerationInternal(tx, f.deps, f.ctx, { allowed: true, basisText: 'Satzung § 12', validFrom: '2027-01-01', documentId: null, decidedOn: '2026-10-29', resolutionId: 'R2' }));
    expect([readSetting(f.deps, 'finance.boardRemunerationValidFrom'), readSetting(f.deps, 'finance.boardRemunerationResolutionId')]).toEqual(['2026-02-01', 'R2']);
    expect(err(await bookEntry(f.deps, f.ctx, f.allowance({ date: '2026-06-01' })))).toBe('ok');
  });

  it('W-3: without an earlier allowance the resolution sets its own day', async () => {
    const f = await boardFixture();
    unwrap(await setBoardRemuneration(f.deps, f.ctx, { allowed: false, basisText: '' }));
    f.deps.db.transaction((tx) => applyBoardRemunerationInternal(tx, f.deps, f.ctx, { allowed: true, basisText: 'Satzung § 12', validFrom: '2027-01-01', documentId: null, decidedOn: '2026-10-29', resolutionId: 'R2' }));
    expect(readSetting(f.deps, 'finance.boardRemunerationValidFrom')).toBe('2027-01-01');
  });
});

