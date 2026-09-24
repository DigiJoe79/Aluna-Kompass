import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listForeignMoney, markTransactionForeign } from '../src/import/transit';
import { setCategoryActive } from '../src/ledger/categories';
import { finalizeEntry } from '../src/ledger/finalize';
import { reverseEntry } from '../src/ledger/reverse';
import { financeCategories } from '../src/schema';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const notOurs = (f: Fixture) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'not-ours')).get()!;

describe('markTransactionForeign', () => {
  it('marks foreign money as a draft on not-ours with the holder in the text, never in the audit log', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 12000, purpose: 'Sammelbestellung Futter' });
    const entry = unwrap(await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: rawId, holder: 'Nachbarverein Tierfreunde', reviewed: false }));
    expect(entry).toMatchObject({ status: 'draft', text: 'Fremdes Geld für: Nachbarverein Tierfreunde', remainderCents: 0, reviewedAt: null });
    expect(entry.moneyLines).toMatchObject([{ accountId: f.bank.id, amountCents: 12000, rawTransactionId: rawId }]);
    expect(entry.allocationLines).toMatchObject([{ categoryId: notOurs(f).id, amountCents: 12000, originLineId: null }]);
    expect(JSON.stringify(f.deps.db.select().from(schema.auditLog).all())).not.toContain('Nachbarverein');

    // Pflichttext, Recht, Eingabe.
    const other = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 500 });
    expect(await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: other, holder: '   ', reviewed: false })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'foreignNeedsHolder' } });
    expect(await markTransactionForeign(f.deps, ctxWith(['finance.read']), { rawTransactionId: other, holder: 'X', reviewed: false })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await markTransactionForeign(f.deps, f.ctx, { holder: 'X', reviewed: false })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await markTransactionForeign(f.deps, { ...f.ctx, channel: 'mcp' }, { rawTransactionId: other, holder: 'X', reviewed: true })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

    // Stillgelegt: gemeldet mit Namen der Kategorie.
    unwrap(await setCategoryActive(f.deps, f.ctx, { id: notOurs(f).id, isActive: false }));
    const res = await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: other, holder: 'X', reviewed: false });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'categoryInactive' } });
    if (!res.ok) expect((res.error as { message: string }).message).toContain('Gehört nicht dem Verein');
  });

  it('links the return to the receipt via originLineId and drops it from the foreign money list', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 12000, date: '2026-03-02' });
    const receipt = unwrap(await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: incoming, holder: 'Nachbarverein', reviewed: true }));
    const final = unwrap(await finalizeEntry(f.deps, f.ctx, { id: receipt.id }));
    const lineId = final.allocationLines[0]!.id;

    expect(unwrap(await listForeignMoney(f.deps, f.ctx))).toEqual({
      items: [{ entryId: final.id, entryNumber: final.number, entryDate: '2026-03-02', amountCents: 12000, holderText: 'Nachbarverein', lineId }],
    });

    const outgoing = insertRaw(f, run, { accountId: f.bank.id, amountCents: -12000, date: '2026-03-09' });
    const returned = unwrap(await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: outgoing, holder: 'Nachbarverein', returnsLineId: lineId, reviewed: false }));
    expect(returned.allocationLines).toMatchObject([{ categoryId: notOurs(f).id, amountCents: -12000, originLineId: lineId }]);
    expect(unwrap(await listForeignMoney(f.deps, f.ctx)).items).toEqual([]);

    // Ein Verweis auf eine Zeile, die nicht fremdes Geld ist, wird abgelehnt.
    const booked = await f.finalEntry();
    const again = insertRaw(f, run, { accountId: f.bank.id, amountCents: -100 });
    expect(await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: again, holder: 'X', returnsLineId: booked.allocationLines[0]!.id, reviewed: false })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: again, holder: 'X', returnsLineId: 'nope', reviewed: false })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });

  it('lists foreign money only while it is not reversed, and needs finance.read', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 8000 });
    const draft = unwrap(await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: rawId, holder: 'Tierheim Nord', reviewed: true }));
    expect(unwrap(await listForeignMoney(f.deps, f.ctx)).items).toMatchObject([{ entryId: draft.id, entryNumber: null, holderText: 'Tierheim Nord' }]);
    const final = unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: final.id }));
    expect(unwrap(await listForeignMoney(f.deps, f.ctx)).items).toEqual([]);
    expect(await listForeignMoney(f.deps, ctxWith(['finance.overview']))).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
  });
});
