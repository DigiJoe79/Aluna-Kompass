import { newId, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteImportRule, listImportRules, previewImportRule, saveImportRule } from '../src/import/rules';
import { deleteCategory, setCategoryActive } from '../src/ledger/categories';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { deletePurpose } from '../src/ledger/purposes';
import { financeImportRules, financeImportRuns, financeRawTransactions } from '../src/schema';
import { ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

function run(f: Fixture, opts: { discarded?: boolean } = {}): string {
  const id = newId();
  f.deps.db
    .insert(financeImportRuns)
    .values({ id, accountId: f.bank.id, format: 'camt053', fileName: 'auszug.xml', fileSha256: id.padEnd(64, '0'), fileKey: null, startedAt: '2026-03-01T09:00:00.000Z', finishedAt: '2026-03-01T09:01:00.000Z', createdByUserId: f.userId, createdChannel: 'ui' })
    .run();
  if (opts.discarded) f.deps.db.update(financeImportRuns).set({ discardedAt: '2026-03-02T00:00:00.000Z', discardedByUserId: f.userId, discardNote: 'falsch' }).where(eq(financeImportRuns.id, id)).run();
  return id;
}

function raw(f: Fixture, runId: string, o: { amountCents: number; purpose: string; name?: string; iban?: string | null; date?: string }): string {
  const id = newId();
  f.deps.db
    .insert(financeRawTransactions)
    .values({
      id, runId, accountId: f.bank.id, bookingDate: o.date ?? '2026-03-05', valueDate: null, amountCents: o.amountCents,
      counterpartyName: o.name ?? 'Schreibwaren Müller', counterpartyIban: o.iban === undefined ? 'DE66999999991234567890' : o.iban, purpose: o.purpose,
      bankReference: null, endToEndId: null, returnCode: null, dedupKey: `k-${id}`, lineIndex: 1, createdAt: '2026-03-05T09:00:00.000Z',
    })
    .run();
  return id;
}

const OFFICE = { name: 'Büromaterial Müller', textContains: 'Büromaterial', direction: 'out' as const };

describe('saveImportRule', () => {
  it('saves a rule with its conditions and result, appends it at the end, and returns the view', async () => {
    const f = await ledgerFixture();
    const first = unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id, entryText: 'Büromaterial' }));
    const second = unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Gebühren', counterpartyIban: 'de66 9999 9999 1234 5678 90', categoryId: f.fees.id }));
    expect(first).toMatchObject({ name: 'Büromaterial Müller', textContains: 'Büromaterial', direction: 'out', categoryId: f.programCosts.id, categoryName: f.programCosts.name, categoryInactive: false, isActive: true, hitCount: 0, differentlyBookedCount: 0 });
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
    // IBAN normalisiert gespeichert.
    expect(second.counterpartyIban).toBe('DE66999999991234567890');
  });

  it('changes an existing rule in place — a rule is working material', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id }));
    const changed = unwrap(await saveImportRule(f.deps, f.ctx, { id: saved.id, name: 'Büro', textContains: null, amountMaxCents: 5000, categoryId: f.fees.id, isActive: false }));
    expect(changed).toMatchObject({ id: saved.id, name: 'Büro', textContains: null, direction: null, amountMaxCents: 5000, categoryId: f.fees.id, isActive: false, sortOrder: saved.sortOrder, createdAt: saved.createdAt });
    expect(f.deps.db.select().from(financeImportRules).all()).toHaveLength(1);
  });

  it('needs finance.entriesWrite', async () => {
    const f = await ledgerFixture();
    expect(await saveImportRule(f.deps, ctxWith(['finance.read']), { ...OFFICE, categoryId: f.programCosts.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
  });

  it('refuses a rule without any condition as validation ruleNeedsCondition', async () => {
    const f = await ledgerFixture();
    expect(await saveImportRule(f.deps, f.ctx, { name: 'Alles', categoryId: f.programCosts.id })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ message: 'ruleNeedsCondition' }] } });
    expect(await saveImportRule(f.deps, f.ctx, { name: 'Leer', textContains: '   ', categoryId: f.programCosts.id })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ message: 'ruleNeedsCondition' }] } });
  });

  it('refuses an invalid iban and a turned-around amount range', async () => {
    const f = await ledgerFixture();
    expect(await saveImportRule(f.deps, f.ctx, { name: 'X', counterpartyIban: 'DE00123', categoryId: f.programCosts.id })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'counterpartyIban', message: 'invalidIban' }] } });
    expect(await saveImportRule(f.deps, f.ctx, { name: 'X', amountMinCents: 500, amountMaxCents: 100, categoryId: f.programCosts.id })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'amountMaxCents', message: 'amountRangeReversed' }] } });
  });

  it('needs an existing category, purpose and account', async () => {
    const f = await ledgerFixture();
    expect(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id, purposeId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await saveImportRule(f.deps, f.ctx, { ...OFFICE, accountId: 'nope', categoryId: f.programCosts.id })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await saveImportRule(f.deps, f.ctx, { ...OFFICE, id: 'nope', categoryId: f.programCosts.id })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });

  it('writes the audit log without name, text condition, iban or contact — only ids, keys and flags', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, counterpartyIban: 'DE66999999991234567890', contactId: f.donor.id, entryText: 'Büromaterial Müller', categoryId: f.programCosts.id }));
    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.importRule.save');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entityType: 'financeImportRule', entityId: saved.id });
    expect(JSON.parse(log[0]!.after as string)).toEqual({
      accountId: null, direction: 'out', categoryId: f.programCosts.id, projectId: null, purposeId: null, taxCode: null, isActive: true, sortOrder: saved.sortOrder,
      hasBankDetailsCondition: true, hasWordCondition: true, hasAmountCondition: false, partySet: true,
    });
    expect(JSON.stringify(log)).not.toMatch(/Müller|Büro|DE66|bueromaterial/);
    expect(JSON.stringify(log)).not.toContain(f.donor.id);
  });
});

describe('listImportRules', () => {
  it('lists active rules in their order; inactive ones only on request', async () => {
    const f = await ledgerFixture();
    const a = unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id, sortOrder: 5 }));
    const b = unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Gebühren', textContains: 'entgelt', categoryId: f.fees.id, sortOrder: 1 }));
    const c = unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Alt', textContains: 'alt', categoryId: f.fees.id, sortOrder: 3, isActive: false }));
    expect(unwrap(await listImportRules(f.deps, f.ctx, {})).rules.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(unwrap(await listImportRules(f.deps, f.ctx, { includeInactive: true })).rules.map((r) => r.id)).toEqual([b.id, c.id, a.id]);
  });

  it('needs finance.read — rules carry names and ibans', async () => {
    const f = await ledgerFixture();
    expect(await listImportRules(f.deps, ctxWith(['finance.overview']), {})).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect((await listImportRules(f.deps, ctxWith(['finance.read']), {})).ok).toBe(true);
  });

  it('lists a rule whose category is inactive as broken', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id }));
    unwrap(await setCategoryActive(f.deps, f.ctx, { id: f.programCosts.id, isActive: false }));
    const [rule] = unwrap(await listImportRules(f.deps, f.ctx, {})).rules;
    expect(rule).toMatchObject({ id: saved.id, categoryInactive: true, categoryName: f.programCosts.name });
  });

  it('counts the earlier transactions a rule hits and how many of them were booked differently', async () => {
    const f = await ledgerFixture();
    const r = run(f);
    const booked = raw(f, r, { amountCents: -1200, purpose: 'Büromaterial März' });
    raw(f, r, { amountCents: -800, purpose: 'Büromaterial April' });
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Büro', moneyLines: [{ accountId: f.bank.id, amountCents: -1200, rawTransactionId: booked }], allocationLines: [{ categoryId: f.fees.id, amountCents: -1200 }] }));
    unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id }));
    const [rule] = unwrap(await listImportRules(f.deps, f.ctx, {})).rules;
    expect(rule).toMatchObject({ hitCount: 2, differentlyBookedCount: 1 });
  });
});

describe('previewImportRule', () => {
  it('counts hits over all transactions of statements not discarded; differently booked only for finalized entries and drafts on another category', async () => {
    const f = await ledgerFixture();
    const r = run(f);
    const finalOther = raw(f, r, { amountCents: -1000, purpose: 'Büromaterial 1' });
    const draftOther = raw(f, r, { amountCents: -1100, purpose: 'Büromaterial 2' });
    const finalSame = raw(f, r, { amountCents: -1200, purpose: 'Büromaterial 3' });
    raw(f, r, { amountCents: -1300, purpose: 'Büromaterial 4' }); // offen: Treffer, aber nicht „anders gebucht“
    raw(f, r, { amountCents: 1400, purpose: 'Büromaterial zurück' }); // Eingang: trifft die Richtung nicht
    raw(f, r, { amountCents: -1500, purpose: 'Druckerpatronen' }); // anderer Text
    raw(f, run(f, { discarded: true }), { amountCents: -1600, purpose: 'Büromaterial verworfen' });

    const a = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'A', moneyLines: [{ accountId: f.bank.id, amountCents: -1000, rawTransactionId: finalOther }], allocationLines: [{ categoryId: f.fees.id, amountCents: -1000 }] }));
    const b = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'B', moneyLines: [{ accountId: f.bank.id, amountCents: -1100, rawTransactionId: draftOther }], allocationLines: [{ categoryId: f.fees.id, amountCents: -1100 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'C', moneyLines: [{ accountId: f.bank.id, amountCents: -1200, rawTransactionId: finalSame }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1200 }] }));

    const preview = unwrap(await previewImportRule(f.deps, f.ctx, { textContains: 'büromaterial', direction: 'out', categoryId: f.programCosts.id }));
    expect(preview.hitCount).toBe(4);
    expect(preview.differentlyBookedCount).toBe(2);
    expect([...preview.differentlyBookedEntryIds].sort()).toEqual([a.id, b.id].sort());
  });

  it('needs finance.read and at least one condition', async () => {
    const f = await ledgerFixture();
    expect(await previewImportRule(f.deps, ctxWith(['finance.overview']), { textContains: 'x', categoryId: f.fees.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await previewImportRule(f.deps, f.ctx, { categoryId: f.fees.id })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ message: 'ruleNeedsCondition' }] } });
  });
});

describe('deleteImportRule', () => {
  it('deletes a rule and records the deletion without its name', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id }));
    expect(unwrap(await deleteImportRule(f.deps, f.ctx, { id: saved.id }))).toEqual({ id: saved.id });
    expect(f.deps.db.select().from(financeImportRules).all()).toEqual([]);
    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.importRule.delete');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entityType: 'financeImportRule', entityId: saved.id });
    expect(JSON.stringify(log)).not.toMatch(/Müller|Büro/);
  });

  it('needs finance.entriesWrite and an existing rule', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id }));
    expect(await deleteImportRule(f.deps, ctxWith(['finance.read']), { id: saved.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await deleteImportRule(f.deps, f.ctx, { id: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await deleteImportRule(f.deps, f.ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('a rule holds its category and purpose', () => {
  it('refuses to delete a category or purpose a rule books on, instead of failing in the database', async () => {
    const f = await ledgerFixture();
    unwrap(await saveImportRule(f.deps, f.ctx, { ...OFFICE, categoryId: f.programCosts.id, purposeId: f.abroadPurpose.id }));
    expect(await deleteCategory(f.deps, f.ctx, { id: f.programCosts.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'categoryInUse' } });
    expect(await deletePurpose(f.deps, f.ctx, { id: f.abroadPurpose.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'purposeInUse' } });
  });
});
