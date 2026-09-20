import { unwrap } from '@kompass/core';
import { eq, getTableColumns } from 'drizzle-orm';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { createCategory } from '../src/ledger/categories';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { createPurpose } from '../src/ledger/purposes';
import { financeAllocationLines, financeEntries, financeMoneyLines } from '../src/schema';
import { setupFinance } from './helpers';

/**
 * Konto und Kategorie tragen einen Fremdschlüssel und müssen deshalb über die
 * F1-Dienste entstehen; Kontakt, Projekt und Rohumsatz sind fremde oder
 * spätere Module und tragen keinen. Der Zweck lebt im selben Schema wie die
 * Zeile und trägt ebenfalls einen — auch er entsteht über den Dienst.
 */
async function fixtures() {
  const { deps, ctx } = setupFinance();
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE02120300000000202051', isMain: true }));
  const category = unwrap(await createCategory(deps, ctx, { key: 'donations', name: 'Spenden', direction: 'income', sphere: 'ideal', incomeKind: 'donation' }));
  const year = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
  const purpose = unwrap(await createPurpose(deps, ctx, { name: 'Dachsanierung' }));
  return { deps, accountId: account.id, categoryId: category.id, yearId: year.id, purposeId: purpose.id };
}

function seedEntry(deps: Awaited<ReturnType<typeof fixtures>>['deps'], accountId: string, categoryId: string, yearId: string, status: 'draft' | 'final') {
  const now = '2026-03-01T10:00:00.000Z';
  deps.db.insert(financeEntries).values({ id: 'E1', number: null, entryDate: '2026-03-01', text: 'Test', status: 'draft', createdByUserId: 'U1', createdChannel: 'ui', createdAt: now, updatedAt: now }).run();
  deps.db.insert(financeMoneyLines).values({ id: 'M1', entryId: 'E1', position: 0, accountId, amountCents: 5000 }).run();
  deps.db.insert(financeAllocationLines).values({ id: 'L1', entryId: 'E1', position: 0, categoryId, amountCents: 5000, taxCode: 'none', rateKind: 'standard', abroad: false, addsToAssets: false }).run();
  if (status === 'final') deps.db.update(financeEntries).set({ status: 'final', number: '2026-0001', finalizedAt: now, finalizedByUserId: 'U1', finalizedChannel: 'ui', fiscalYearId: yearId }).where(eq(financeEntries.id, 'E1')).run();
}
const FINAL = /finalized finance entry is immutable/;

describe('a finalized entry is immutable in the database itself', () => {
  it('a draft can be changed and deleted freely', async () => {
    const { deps, accountId, categoryId, yearId } = await fixtures();
    seedEntry(deps, accountId, categoryId, yearId, 'draft');
    deps.db.update(financeMoneyLines).set({ amountCents: 6000 }).where(eq(financeMoneyLines.id, 'M1')).run();
    deps.db.delete(financeAllocationLines).where(eq(financeAllocationLines.id, 'L1')).run();
    deps.db.delete(financeMoneyLines).where(eq(financeMoneyLines.id, 'M1')).run();
    deps.db.delete(financeEntries).where(eq(financeEntries.id, 'E1')).run();
  });

  it('head: nothing but reversedByEntryId', async () => {
    const { deps, accountId, categoryId, yearId } = await fixtures();
    seedEntry(deps, accountId, categoryId, yearId, 'final');
    for (const change of [{ text: 'x' }, { entryDate: '2026-03-02' }, { status: 'draft' as const }, { number: '2026-0002' }, { reversesEntryId: 'E0' }, { finalizedAt: 'x' }]) {
      expect(() => deps.db.update(financeEntries).set(change).where(eq(financeEntries.id, 'E1')).run(), JSON.stringify(change)).toThrow(FINAL);
    }
    deps.db.update(financeEntries).set({ reversedByEntryId: 'E2' }).where(eq(financeEntries.id, 'E1')).run();
    expect(() => deps.db.delete(financeEntries).where(eq(financeEntries.id, 'E1')).run()).toThrow(FINAL);
  });

  it('money line: only rawReleasedAt, and rawTransactionId from empty to a value', async () => {
    const { deps, accountId, categoryId, yearId } = await fixtures();
    seedEntry(deps, accountId, categoryId, yearId, 'final');
    const line = () => deps.db.update(financeMoneyLines);
    expect(() => line().set({ amountCents: 1 }).where(eq(financeMoneyLines.id, 'M1')).run()).toThrow(FINAL);
    expect(() => line().set({ accountId: 'A2' }).where(eq(financeMoneyLines.id, 'M1')).run()).toThrow(FINAL);
    line().set({ rawTransactionId: 'R1' }).where(eq(financeMoneyLines.id, 'M1')).run();
    expect(() => line().set({ rawTransactionId: 'R2' }).where(eq(financeMoneyLines.id, 'M1')).run()).toThrow(FINAL);
    line().set({ rawReleasedAt: '2026-04-01T00:00:00.000Z' }).where(eq(financeMoneyLines.id, 'M1')).run();
    expect(() => deps.db.delete(financeMoneyLines).where(eq(financeMoneyLines.id, 'M1')).run()).toThrow(FINAL);
    expect(() => deps.db.insert(financeMoneyLines).values({ id: 'M2', entryId: 'E1', position: 1, accountId, amountCents: 1 }).run()).toThrow(FINAL);
  });

  it('allocation line: only contact, project, purpose and the abroad switch', async () => {
    const { deps, accountId, categoryId, yearId, purposeId } = await fixtures();
    seedEntry(deps, accountId, categoryId, yearId, 'final');
    const line = () => deps.db.update(financeAllocationLines);
    for (const change of [{ amountCents: 1 }, { categoryId: 'C2' }, { taxCode: 'standard' }, { rateKind: 'reduced' as const }, { addsToAssets: true }, { originLineId: 'L0' }]) {
      expect(() => line().set(change).where(eq(financeAllocationLines.id, 'L1')).run(), JSON.stringify(change)).toThrow(FINAL);
    }
    line().set({ contactId: 'K1', projectId: 'P1', purposeId, abroad: true }).where(eq(financeAllocationLines.id, 'L1')).run();
    expect(() => deps.db.delete(financeAllocationLines).where(eq(financeAllocationLines.id, 'L1')).run()).toThrow(FINAL);
    expect(() => deps.db.insert(financeAllocationLines).values({ id: 'L2', entryId: 'E1', position: 1, categoryId, amountCents: 1, taxCode: 'none', rateKind: 'standard', abroad: false, addsToAssets: false }).run()).toThrow(FINAL);
  });

  it('a raw transaction is held by one money line at a time — until it is released', async () => {
    const { deps, accountId, categoryId, yearId } = await fixtures();
    seedEntry(deps, accountId, categoryId, yearId, 'draft');
    deps.db.update(financeMoneyLines).set({ rawTransactionId: 'R1' }).where(eq(financeMoneyLines.id, 'M1')).run();
    const second = { id: 'M2', entryId: 'E1', position: 1, accountId, amountCents: 1, rawTransactionId: 'R1' };
    expect(() => deps.db.insert(financeMoneyLines).values(second).run()).toThrow(/UNIQUE/);
    deps.db.update(financeMoneyLines).set({ rawReleasedAt: '2026-04-01T00:00:00.000Z' }).where(eq(financeMoneyLines.id, 'M1')).run();
    deps.db.insert(financeMoneyLines).values(second).run();
  });
});

/**
 * Mechanischer Wächter für die drei Trigger, die eine festgeschriebene Zeile
 * sperren: Jede Spalte einer Tabelle steht entweder in einer `UPDATE OF`-Liste
 * eines ihrer Trigger, oder sie gehört zu den abschließend erlaubten Spalten
 * der Spec (5.2). Fällt eine Spalte durch beide Raster, ließe sie sich an
 * einer festgeschriebenen Zeile ändern, ohne dass ein Trigger es bemerkt.
 */
describe('every column of a locked table is either guarded or explicitly free', () => {
  const migrationsDir = path.resolve(import.meta.dirname, '../../../core/src/db/migrations');
  const allSql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
    .join('\n');

  function updateOfColumns(triggerName: string): string[] {
    const match = allSql.match(new RegExp(`CREATE TRIGGER ${triggerName} BEFORE UPDATE OF ([^\\n]+?) ON`));
    if (!match) throw new Error(`trigger not found: ${triggerName}`);
    return match[1]!.split(',').map((c) => c.trim());
  }

  function dbColumns(table: Parameters<typeof getTableColumns>[0]): string[] {
    return Object.values(getTableColumns(table)).map((c) => (c as { name: string }).name);
  }

  it('finance_entries: everything but reversed_by_entry_id and updated_at is guarded', () => {
    const guarded = new Set(updateOfColumns('finance_entries_final_no_update'));
    const free = new Set(['reversed_by_entry_id', 'updated_at']);
    for (const column of dbColumns(financeEntries)) {
      expect(guarded.has(column) || free.has(column), column).toBe(true);
    }
  });

  it('finance_money_lines: everything but raw_released_at is guarded (raw_transaction_id only one way)', () => {
    const guarded = new Set([...updateOfColumns('finance_money_lines_final_no_update'), ...updateOfColumns('finance_money_lines_final_raw_once')]);
    const free = new Set(['raw_released_at']);
    for (const column of dbColumns(financeMoneyLines)) {
      expect(guarded.has(column) || free.has(column), column).toBe(true);
    }
  });

  it('finance_allocation_lines: everything but contact, project, purpose and abroad is guarded', () => {
    const guarded = new Set(updateOfColumns('finance_allocation_lines_final_no_update'));
    const free = new Set(['contact_id', 'project_id', 'purpose_id', 'abroad']);
    for (const column of dbColumns(financeAllocationLines)) {
      expect(guarded.has(column) || free.has(column), column).toBe(true);
    }
  });
});
