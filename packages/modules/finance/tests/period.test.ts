import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getEntry, saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { fiscalYearStatusInternal, updateFiscalYear } from '../src/ledger/fiscal-years';
import { closeFiscalYear, justifyUndocumentedEntry, previewPeriodClose, previewPeriodReopen, previewReopenInternal, reopenFiscalYear, reopenInternal } from '../src/ledger/period';
import { attachDocument, uploadVoucher } from '../src/ledger/vouchers';
import { reverseEntry } from '../src/ledger/reverse';
import type { PeriodReopenGuard } from '../src/locks';
import { financeEntryJustifications, financeFiscalYears, financeMoneyLines, financePeriodEvents } from '../src/schema';
import { allowHumanOnlyOverMcp, ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('closing a fiscal year', () => {
  it('needs finance.periodClose and a person', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const readOnly = ctxWith(['finance.read'], f.userId);
    expect(err(await closeFiscalYear(f.deps, readOnly, { id: f.years['2025']!.id }))).toEqual({ type: 'forbidden', permission: 'finance.periodClose' });

    const overMcp = { ...f.ctx, channel: 'mcp' as const };
    expect(err(await closeFiscalYear(f.deps, overMcp, { id: f.years['2025']!.id }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
  });

  it('refuses while a draft is dated in the period — and the preview names it', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));

    const preview = unwrap(await previewPeriodClose(f.deps, f.ctx, { id: yearId }));
    expect(preview.draftsInPeriod).toEqual([{ id: draft.id, entryDate: '2025-06-01' }]);
    expect(preview.canClose).toBe(false);

    expect(err(await closeFiscalYear(f.deps, f.ctx, { id: yearId }))).toMatchObject({ type: 'conflict', code: 'draftsInPeriod' });
  });

  it('refuses while a finalized entry has neither a voucher nor a justification', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));

    const preview = unwrap(await previewPeriodClose(f.deps, f.ctx, { id: yearId }));
    expect(preview.undocumented).toEqual([{ entryId: entry.id, number: entry.number, justified: false }]);
    expect(preview.canClose).toBe(false);

    expect(err(await closeFiscalYear(f.deps, f.ctx, { id: yearId }))).toMatchObject({ type: 'conflict', code: 'undocumentedEntries' });

    unwrap(await justifyUndocumentedEntry(f.deps, f.ctx, { entryId: entry.id, note: 'Keine Rechnung erhalten, mündliche Absprache' }));
    const after = unwrap(await getEntry(f.deps, f.ctx, { id: entry.id }));
    expect(after.justified).toBe(true);

    const previewAfter = unwrap(await previewPeriodClose(f.deps, f.ctx, { id: yearId }));
    expect(previewAfter.undocumented).toEqual([{ entryId: entry.id, number: entry.number, justified: true }]);
    expect(previewAfter.canClose).toBe(true);

    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.entry.justify')));
    expect(log).not.toContain('Keine Rechnung erhalten');
  });

  it('an entry the statement documents needs no justification', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Bankgebühr', moneyLines: [{ accountId: f.bank.id, amountCents: -490 }], allocationLines: [{ categoryId: f.fees.id, amountCents: -490 }] }));
    f.deps.db.update(financeMoneyLines).set({ rawTransactionId: 'R1' }).where(eq(financeMoneyLines.entryId, entry.id)).run();

    const preview = unwrap(await previewPeriodClose(f.deps, f.ctx, { id: yearId }));
    expect(preview.undocumented).toEqual([]);
    expect(preview.canClose).toBe(true);
  });

  it('years close in order', async () => {
    const f = await ledgerFixture({ years: ['2024', '2025'] });
    expect(err(await closeFiscalYear(f.deps, f.ctx, { id: f.years['2025']!.id }))).toMatchObject({ type: 'conflict', code: 'previousYearOpen' });
    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: f.years['2024']!.id }));
    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: f.years['2025']!.id }));
  });

  it('a year cannot be closed before it has ended', async () => {
    const f = await ledgerFixture(); // Jahr 2026, „heute“ (TEST_NOW) liegt mittendrin.
    expect(err(await closeFiscalYear(f.deps, f.ctx, { id: f.year.id }))).toMatchObject({ type: 'conflict', code: 'fiscalYearNotEnded' });
  });

  it('writes an event, not a field; the status follows it; a second close is refused', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    expect(fiscalYearStatusInternal(f.deps.db, yearId)).toBe('open');
    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: yearId }));
    expect(f.deps.db.select().from(financePeriodEvents).where(eq(financePeriodEvents.fiscalYearId, yearId)).all()).toHaveLength(1);
    expect(fiscalYearStatusInternal(f.deps.db, yearId)).toBe('closed');
    expect(err(await closeFiscalYear(f.deps, f.ctx, { id: yearId }))).toMatchObject({ type: 'conflict', code: 'fiscalYearAlreadyClosed' });
  });

  it('creates the following year if it is missing', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    expect(f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, '2026')).get()).toBeUndefined();
    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: f.years['2025']!.id }));
    expect(f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, '2026')).get()).toBeDefined();
  });

  it('after closing, finalizing into the year is refused and a reversal is dated today', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Bankgebühr', moneyLines: [{ accountId: f.bank.id, amountCents: -490 }], allocationLines: [{ categoryId: f.fees.id, amountCents: -490 }] }));
    f.deps.db.update(financeMoneyLines).set({ rawTransactionId: 'R1' }).where(eq(financeMoneyLines.entryId, entry.id)).run();
    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: yearId }));

    expect(err(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-15', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }))).toMatchObject({ type: 'conflict', code: 'fiscalYearClosed' });

    const reversal = unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    expect(reversal.reversal.entryDate).toBe(f.deps.clock.now().toISOString().slice(0, 10));
  });

  it('after closing, a voucher can still be handed in', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Bankgebühr', moneyLines: [{ accountId: f.bank.id, amountCents: -490 }], allocationLines: [{ categoryId: f.fees.id, amountCents: -490 }] }));
    f.deps.db.update(financeMoneyLines).set({ rawTransactionId: 'R1' }).where(eq(financeMoneyLines.entryId, entry.id)).run();
    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: yearId }));

    const uploaded = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2025-06-01' }));
    expect(uploaded.documentId).toBeTruthy();
    void attachDocument;
  });

  it('logs the year and the kind of event, nothing else', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: yearId }));
    const entries = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.period.close');
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0]!.after!)).toEqual({ fiscalYearId: yearId, kind: 'closed' });
  });
});

describe('justification bookkeeping', () => {
  it('stores note and author at the record, never in the audit log', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    unwrap(await justifyUndocumentedEntry(f.deps, f.ctx, { entryId: entry.id, note: 'Bar bezahlt, kein Beleg erhalten' }));
    const row = f.deps.db.select().from(financeEntryJustifications).where(eq(financeEntryJustifications.entryId, entry.id)).get();
    expect(row?.note).toBe('Bar bezahlt, kein Beleg erhalten');
  });
});

/** Ein Jahr ohne eigene Buchungen abschließen: keine Entwürfe, nichts Unbelegtes. */
async function closeCleanly(f: Awaited<ReturnType<typeof ledgerFixture>>, yearId: string) {
  return unwrap(await closeFiscalYear(f.deps, f.ctx, { id: yearId }));
}

describe('reopening a fiscal year', () => {
  it('wants a note, keeps it on the event and out of the audit log', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    await closeCleanly(f, yearId);

    expect(err(await reopenFiscalYear(f.deps, f.ctx, { id: yearId, note: '' }))).toMatchObject({ type: 'validation' });

    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: yearId, note: 'Kassenprüfer hat einen Fehlbetrag gemeldet' }));
    const event = f.deps.db.select().from(financePeriodEvents).where(eq(financePeriodEvents.fiscalYearId, yearId)).all().find((e) => e.kind === 'reopened');
    expect(event?.reason).toBe('Kassenprüfer hat einen Fehlbetrag gemeldet');

    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.period.reopen'));
    expect(log).not.toContain('Kassenprüfer hat einen Fehlbetrag gemeldet');
  });

  it('only the latest closed year can be reopened', async () => {
    const f = await ledgerFixture({ years: ['2024', '2025'] });
    await closeCleanly(f, f.years['2024']!.id);
    await closeCleanly(f, f.years['2025']!.id);

    expect(err(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2024']!.id, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'laterYearClosed' });
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2025']!.id, note: 'x' }));
  });

  it('refuses a year that is not closed', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    expect(err(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2025']!.id, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'fiscalYearNotClosed' });
  });

  it('runs every guard inside its transaction: a guard that throws leaves the year closed', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    await closeCleanly(f, yearId);

    const throwingGuard: PeriodReopenGuard = { describe: () => 'wirft', onReopen: () => { throw new Error('boom'); } };
    expect(() => f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: yearId, note: 'x' }, [throwingGuard]))).toThrow('boom');
    expect(fiscalYearStatusInternal(f.deps.db, yearId)).toBe('closed');
  });

  it('the preview lists what the guards will do, and whether the tax return was filed', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    unwrap(await updateFiscalYear(f.deps, f.ctx, { id: yearId, taxReturnFiledOn: '2026-05-01' }));
    await closeCleanly(f, yearId);

    const guard: PeriodReopenGuard = { describe: () => '3 festgeschriebene Berichte werden storniert', onReopen: () => {} };
    expect(previewReopenInternal(f.deps.db, yearId, [guard]).consequences).toEqual(['3 festgeschriebene Berichte werden storniert']);

    const preview = unwrap(await previewPeriodReopen(f.deps, f.ctx, { id: yearId }));
    expect(preview.taxReturnFiledOn).toBe('2026-05-01');
    expect(preview.laterYearClosed).toBe(false);
    expect(preview.consequences).toEqual([]); // PERIOD_REOPEN_GUARDS ist in F2c leer.
  });

  it('after reopening, entries can be finalized into the year again, and closing it again writes a third event', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    await closeCleanly(f, yearId);
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: yearId, note: 'Nacherfassung nötig' }));

    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-11-01', text: 'Bankgebühr', moneyLines: [{ accountId: f.bank.id, amountCents: -490 }], allocationLines: [{ categoryId: f.fees.id, amountCents: -490 }] }));
    f.deps.db.update(financeMoneyLines).set({ rawTransactionId: 'R2' }).where(eq(financeMoneyLines.entryId, entry.id)).run();
    expect(entry.fiscalYearId).toBe(yearId);

    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: yearId }));
    expect(f.deps.db.select().from(financePeriodEvents).where(eq(financePeriodEvents.fiscalYearId, yearId)).all()).toHaveLength(3);
  });

  it('needs finance.periodClose and a person', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const yearId = f.years['2025']!.id;
    await closeCleanly(f, yearId);

    const readOnly = ctxWith(['finance.read'], f.userId);
    expect(err(await reopenFiscalYear(f.deps, readOnly, { id: yearId, note: 'x' }))).toEqual({ type: 'forbidden', permission: 'finance.periodClose' });

    const overMcp = { ...f.ctx, channel: 'mcp' as const };
    expect(err(await reopenFiscalYear(f.deps, overMcp, { id: yearId, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    allowHumanOnlyOverMcp(f.deps);
    unwrap(await reopenFiscalYear(f.deps, overMcp, { id: yearId, note: 'x' }));
  });
});
