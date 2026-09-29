import { newId, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookFromTransaction } from '../src/import/book';
import { deleteDraft, saveDraft } from '../src/ledger/entries';
import { finalizeEntry } from '../src/ledger/finalize';
import { createOpenItem, openCentsInternal } from '../src/ledger/open-items';
import { financeModule } from '../src/manifest';
import { financeAllocationLines, financeFiscalYears, financeImportCandidates, financeInKindDetails } from '../src/schema';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

/**
 * Befund 4 / A5: Was das Manifest als `deletable: false` führt, ist auch in der Datenbank gesperrt —
 * nicht nur im Dienst. Jede Regel steht hier mit ihrer Tabelle; eine neue Regel ohne Eintrag bricht den Wächter.
 */
const TABLE_OF_UNDELETABLE_ENTITY: Record<string, string> = {
  financeImportProfile: 'finance_import_profiles',
  financeFiscalYear: 'finance_fiscal_years',
  financePeriodEvent: 'finance_period_events',
  financeEntry: 'finance_entries',
  financeOpenItem: 'finance_open_items',
  financeAllocationCorrection: 'finance_allocation_corrections',
  financeEntryDocument: 'finance_entry_documents',
  financeEntryJustification: 'finance_entry_justifications',
  financeNotReturnMark: 'finance_not_return_marks',
  financeCashCount: 'finance_cash_counts',
  financeNotice: 'finance_notices',
  financeSigner: 'finance_signers',
  financeConfirmation: 'finance_confirmations',
  financeConfirmationRun: 'finance_confirmation_runs',
  financeConfirmationRunItem: 'finance_confirmation_run_items',
  financeConfirmationLine: 'finance_confirmation_lines',
  financeInKindDetails: 'finance_in_kind_details',
  financeExpenseClaim: 'finance_expense_claims',
  financePartnerNotice: 'finance_partner_notices',
  financePartnerPaymentPosition: 'finance_partner_payment_positions',
  financePartnerPayment: 'finance_partner_payments',
  financeReserveMovement: 'finance_reserve_movements',
  financePurposeTransfer: 'finance_purpose_transfers',
};
/** Tabellen ohne eigene Regel, die A5 trotzdem nannte (Importlauf mit Rohumsätzen und Kandidaten, Positionen, bezahlte Zeilen, Ausgleiche). */
const EXTRA_LOCKED_TABLES = ['finance_import_runs', 'finance_raw_transactions', 'finance_import_candidates', 'finance_expense_positions', 'finance_partner_paid_lines', 'finance_open_item_settlements'];

async function fixtures() {
  const f = await ledgerFixture();
  const entry = await f.finalDonation({ date: '2026-03-01', cents: 5000, contactId: f.donor.id });
  const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
  return { ...f, entry, lineId: line.id };
}
type F = Awaited<ReturnType<typeof fixtures>>;

const del = (f: F, table: string, key: string, value: string) => () => f.deps.sqlite.prepare(`delete from ${table} where ${key} = ?`).run(value);

describe('Löschsperren sind Trigger', () => {
  it('every deletable:false rule of the manifest has a table with a BEFORE DELETE trigger', async () => {
    const f = await fixtures();
    const undeletable = financeModule.deletionRules!.filter((r) => !r.deletable).map((r) => r.entity);
    expect(undeletable.filter((e) => !(e in TABLE_OF_UNDELETABLE_ENTITY)), 'Regel ohne Tabelle im Test').toEqual([]);
    expect(Object.keys(TABLE_OF_UNDELETABLE_ENTITY).filter((e) => !undeletable.includes(e)), 'Eintrag ohne Regel im Manifest').toEqual([]);
    const locked = new Set(f.deps.sqlite.prepare(`select tbl_name as t, sql from sqlite_master where type = 'trigger'`).all().filter((r) => /BEFORE DELETE/i.test((r as { sql: string }).sql)).map((r) => (r as { t: string }).t));
    for (const table of [...Object.values(TABLE_OF_UNDELETABLE_ENTITY), ...EXTRA_LOCKED_TABLES]) expect(locked.has(table), table).toBe(true);
  });

  it('a fiscal year and its period events cannot be deleted', async () => {
    const f = await fixtures();
    expect(del(f, 'finance_fiscal_years', 'id', f.year.id)).toThrow();
    f.closeYear(f.year.id);
    const event = f.deps.sqlite.prepare('select id from finance_period_events').get() as { id: string };
    expect(del(f, 'finance_period_events', 'id', event.id)).toThrow(/permanent/);
    expect(f.deps.db.select().from(financeFiscalYears).all().length).toBeGreaterThan(0);
  });

  it('an open item cannot be deleted, cancelled or not', async () => {
    const f = await fixtures();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000 }));
    expect(del(f, 'finance_open_items', 'id', item.id)).toThrow(/permanent/);
  });

  it('a justification and a not-return mark of an entry cannot be deleted', async () => {
    const f = await fixtures();
    f.deps.sqlite.pragma('foreign_keys = OFF');
    f.deps.sqlite.prepare(`insert into finance_entry_justifications (entry_id, note, by_user_id, at) values (?, 'n', 'U', 'x')`).run(f.entry.id);
    f.deps.sqlite.prepare(`insert into finance_not_return_marks (entry_id, note, by_user_id, at) values (?, 'n', 'U', 'x')`).run(f.entry.id);
    expect(del(f, 'finance_entry_justifications', 'entry_id', f.entry.id)).toThrow(/permanent/);
    expect(del(f, 'finance_not_return_marks', 'entry_id', f.entry.id)).toThrow(/permanent/);
  });

  it('a partner notice cannot be deleted', async () => {
    const f = await fixtures();
    f.deps.sqlite.pragma('foreign_keys = OFF');
    const id = newId();
    f.deps.sqlite.prepare(`insert into finance_partner_notices (id, partner_id, kind, notice_date, received_on, created_at, created_by_user_id, updated_at) values (?, 'P', 'section60a', '2026-01-01', '2026-01-02', 'x', 'U', 'x')`).run(id);
    expect(del(f, 'finance_partner_notices', 'id', id)).toThrow(/permanent/);
  });

  it('the in-kind details of a finalized line stay; those of a draft go with the draft', async () => {
    const f = await fixtures();
    const insert = (lineId: string) =>
      f.deps.db.insert(financeInKindDetails).values({ lineId, item: 'Sofa', condition: 'gut', valuation: 'Schätzung', origin: 'private', createdAt: 'x', updatedAt: 'x' }).run();
    insert(f.lineId);
    expect(del(f, 'finance_in_kind_details', 'line_id', f.lineId)).toThrow(/permanent|immutable/);

    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Sachspende', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    const draftLine = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, draft.id)).get()!;
    insert(draftLine.id);
    unwrap(await deleteDraft(f.deps, f.ctx, { id: draft.id }));
    expect(f.deps.db.select().from(financeInKindDetails).where(eq(financeInKindDetails.lineId, draftLine.id)).all()).toHaveLength(0);
  });

  it('a candidate whose transaction is booked cannot be deleted; a loose one can (the discard of a run does)', async () => {
    const f = await fixtures();
    const runId = insertRun(f, f.bank.id);
    const rawId = insertRaw(f, runId, { accountId: f.bank.id, amountCents: -1990 });
    const draft = unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: rawId, text: 'Büromaterial', allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1990 }], reviewed: true }));
    unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id }));
    const candidate = (raw: string | null) => {
      const id = newId();
      f.deps.db.insert(financeImportCandidates).values({ id, runId, accountId: f.bank.id, line: '{}', dedupKey: `k-${id}`, decision: raw ? 'own' : null, rawTransactionId: raw }).run();
      return id;
    };
    expect(del(f, 'finance_import_candidates', 'id', candidate(rawId))).toThrow(/permanent/);
    expect(del(f, 'finance_import_candidates', 'id', candidate(null))).not.toThrow();
  });

  it('a settlement taken from a draft goes with the draft — the item is open again', async () => {
    const f = await fixtures();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1000 }));
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Zahlung', moneyLines: [{ accountId: f.bank.id, amountCents: 1000, settlements: [{ openItemId: item.id, amountCents: 1000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    unwrap(await deleteDraft(f.deps, f.ctx, { id: draft.id }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(1000);
  });
});
