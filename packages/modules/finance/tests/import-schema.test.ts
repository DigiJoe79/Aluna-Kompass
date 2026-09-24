import { newId, unwrap } from '@kompass/core';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { createCategory } from '../src/ledger/categories';
import { financeAllocationLines, financeContactBankAccounts, financeEntries, financeImportCandidates, financeImportRules, financeImportRuns, financeMoneyLines, financeRawTransactions } from '../src/schema';
import { setupFinance } from './helpers';

/**
 * Der mechanische Wächter der neuen Tabellen (F4 Task 2): jede Regel aus dem
 * Plan gegen die echte Datenbank, roh über Drizzle — wie
 * `entry-immutability.test.ts` es für die Buchung selbst vormacht.
 */
async function fixtures() {
  const { deps, ctx } = setupFinance();
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
  const category = unwrap(await createCategory(deps, ctx, { key: 'donations', name: 'Spenden', direction: 'income', sphere: 'ideal', incomeKind: 'donation' }));
  return { deps, accountId: account.id, categoryId: category.id };
}

function seedRun(deps: Awaited<ReturnType<typeof fixtures>>['deps'], accountId: string, overrides: Partial<typeof financeImportRuns.$inferInsert> = {}) {
  const id = overrides.id ?? newId();
  deps.db
    .insert(financeImportRuns)
    .values({
      id,
      accountId,
      format: 'camt053',
      fileName: 'auszug-maerz.xml',
      fileSha256: 'a'.repeat(64),
      fileKey: 'files/finance/auszug-maerz.xml',
      startedAt: '2026-03-01T09:00:00.000Z',
      createdByUserId: 'U1',
      createdChannel: 'ui',
      ...overrides,
    })
    .run();
  return id;
}

function seedRawTransaction(deps: Awaited<ReturnType<typeof fixtures>>['deps'], runId: string, accountId: string, overrides: Partial<typeof financeRawTransactions.$inferInsert> = {}) {
  const id = overrides.id ?? newId();
  deps.db
    .insert(financeRawTransactions)
    .values({
      id,
      runId,
      accountId,
      bookingDate: '2026-03-05',
      valueDate: '2026-03-05',
      amountCents: 5000,
      counterpartyName: 'Erika Beispiel',
      counterpartyIban: 'DE66999999991234567890',
      purpose: 'Spende',
      bankReference: null,
      endToEndId: null,
      returnCode: null,
      dedupKey: `2026-03-05|5000|DE66999999991234567890|spende|0${id}`,
      lineIndex: 1,
      createdAt: '2026-03-05T09:00:00.000Z',
      ...overrides,
    })
    .run();
  return id;
}

/** Eine festgeschriebene Buchung, deren Geldzeile auf `rawTransactionId` zeigt — Muster `entry-immutability.test.ts`. */
function bookFinalEntryFor(deps: Awaited<ReturnType<typeof fixtures>>['deps'], accountId: string, categoryId: string, rawTransactionId: string) {
  const now = '2026-03-06T10:00:00.000Z';
  const entryId = newId();
  const lineId = newId();
  deps.db.insert(financeEntries).values({ id: entryId, number: null, entryDate: '2026-03-06', text: 'Test', status: 'draft', createdByUserId: 'U1', createdChannel: 'ui', createdAt: now, updatedAt: now }).run();
  deps.db.insert(financeMoneyLines).values({ id: lineId, entryId, position: 0, accountId, amountCents: 5000 }).run();
  deps.db.insert(financeAllocationLines).values({ id: newId(), entryId, position: 0, categoryId, amountCents: 5000, taxCode: 'none', rateKind: 'standard', abroad: false, addsToAssets: false }).run();
  deps.db.update(financeEntries).set({ status: 'final', number: '2026-0001', finalizedAt: now, finalizedByUserId: 'U1', finalizedChannel: 'ui' }).where(eq(financeEntries.id, entryId)).run();
  deps.db.update(financeMoneyLines).set({ rawTransactionId }).where(eq(financeMoneyLines.id, lineId)).run();
  return entryId;
}

describe('finance_raw_transactions', () => {
  it('never lets a raw transaction be updated', async () => {
    const { deps, accountId } = await fixtures();
    const runId = seedRun(deps, accountId);
    const id = seedRawTransaction(deps, runId, accountId);
    expect(() => deps.db.update(financeRawTransactions).set({ purpose: 'anders' }).where(eq(financeRawTransactions.id, id)).run()).toThrow(/permanent|immutable/);
    expect(() => deps.db.update(financeRawTransactions).set({ amountCents: 1 }).where(eq(financeRawTransactions.id, id)).run()).toThrow(/permanent|immutable/);
  });

  it('lets a raw transaction be deleted only while no finalized, unreversed entry points to it', async () => {
    const { deps, accountId, categoryId } = await fixtures();
    const runId = seedRun(deps, accountId);

    const free = seedRawTransaction(deps, runId, accountId, { bankReference: 'REF-FREE' });
    deps.db.delete(financeRawTransactions).where(eq(financeRawTransactions.id, free)).run();

    const booked = seedRawTransaction(deps, runId, accountId, { bankReference: 'REF-BOOKED' });
    const entryId = bookFinalEntryFor(deps, accountId, categoryId, booked);
    expect(() => deps.db.delete(financeRawTransactions).where(eq(financeRawTransactions.id, booked)).run()).toThrow(/permanent|immutable/);

    // Zurückgenommen (Muster `reverseInternal`: reversedByEntryId gesetzt) — jetzt frei.
    deps.db.update(financeEntries).set({ reversedByEntryId: 'FAKE-REVERSAL' }).where(eq(financeEntries.id, entryId)).run();
    deps.db.delete(financeRawTransactions).where(eq(financeRawTransactions.id, booked)).run();
  });

  it('refuses a second raw transaction with the same bank reference on the same account', async () => {
    const { deps, accountId } = await fixtures();
    const runId = seedRun(deps, accountId);
    seedRawTransaction(deps, runId, accountId, { bankReference: 'REF-DUP' });
    expect(() => seedRawTransaction(deps, runId, accountId, { bankReference: 'REF-DUP' })).toThrow(/UNIQUE/);
    // Zwei Zeilen ohne Referenz sind keine Dublette der Datenbank (der Dublettenschutz ohne Referenz laeuft ueber den Dienst, Task 3).
    seedRawTransaction(deps, runId, accountId, { bankReference: null });
    seedRawTransaction(deps, runId, accountId, { bankReference: null });
  });
});

describe('finance_import_runs', () => {
  it('freezes the facts of a run once it has finished or failed; afterwards only discarding is possible, once', async () => {
    const { deps, accountId } = await fixtures();
    const runId = seedRun(deps, accountId);

    // Waehrend des Laufs (weder finishedAt noch failedAt gesetzt): Zaehler und Abschlussfelder aenderbar.
    deps.db
      .update(financeImportRuns)
      .set({ periodFrom: '2026-03-01', periodTo: '2026-03-31', openingCents: 10000, closingCents: 11000, countNew: 1, countKnown: 0, countHeld: 0, countPendingSkipped: 0, finishedAt: '2026-03-01T09:05:00.000Z' })
      .where(eq(financeImportRuns.id, runId))
      .run();

    // Danach: die Tatsachen stehen fest.
    expect(() => deps.db.update(financeImportRuns).set({ countNew: 2 }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
    expect(() => deps.db.update(financeImportRuns).set({ closingCents: 1 }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
    expect(() => deps.db.update(financeImportRuns).set({ finishedAt: '2026-03-02T00:00:00.000Z' }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);

    // Danach aenderbar: nur discarded_* (einmal) und fileKey -> NULL (einmal).
    deps.db.update(financeImportRuns).set({ discardedAt: '2026-04-01T00:00:00.000Z', discardedByUserId: 'U1', discardNote: 'Falsches Konto' }).where(eq(financeImportRuns.id, runId)).run();
    expect(() => deps.db.update(financeImportRuns).set({ discardNote: 'anders' }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);

    deps.db.update(financeImportRuns).set({ fileKey: null }).where(eq(financeImportRuns.id, runId)).run();
    expect(() => deps.db.update(financeImportRuns).set({ fileKey: null }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
    expect(() => deps.db.update(financeImportRuns).set({ fileKey: 'anderer/pfad' }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
  });

  it('never lets identity facts of a run change, at any time', async () => {
    const { deps, accountId } = await fixtures();
    const runId = seedRun(deps, accountId);
    expect(() => deps.db.update(financeImportRuns).set({ fileName: 'anders.xml' }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
    expect(() => deps.db.update(financeImportRuns).set({ fileSha256: 'b'.repeat(64) }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
    expect(() => deps.db.update(financeImportRuns).set({ format: 'camt053' }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
  });

  it('refuses discarding before the run has finished or failed', async () => {
    const { deps, accountId } = await fixtures();
    const runId = seedRun(deps, accountId);
    expect(() => deps.db.update(financeImportRuns).set({ discardedAt: '2026-04-01T00:00:00.000Z', discardedByUserId: 'U1', discardNote: 'zu frueh' }).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
  });

  it('never lets a run be deleted', async () => {
    const { deps, accountId } = await fixtures();
    const runId = seedRun(deps, accountId);
    expect(() => deps.db.delete(financeImportRuns).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
    deps.db.update(financeImportRuns).set({ finishedAt: '2026-03-01T09:05:00.000Z' }).where(eq(financeImportRuns.id, runId)).run();
    expect(() => deps.db.delete(financeImportRuns).where(eq(financeImportRuns.id, runId)).run()).toThrow(/permanent|immutable/);
  });
});

describe('finance_import_candidates', () => {
  it('lets a candidate be decided exactly once', async () => {
    const { deps, accountId } = await fixtures();
    const runId = seedRun(deps, accountId);
    const candidateId = newId();
    deps.db
      .insert(financeImportCandidates)
      .values({ id: candidateId, runId, accountId, line: JSON.stringify({ index: 1 }), matchesRawTransactionId: null, dedupKey: '2026-03-05|5000||spende|0' })
      .run();

    deps.db.update(financeImportCandidates).set({ decision: 'same', decidedAt: '2026-03-06T00:00:00.000Z', decidedByUserId: 'U1' }).where(eq(financeImportCandidates.id, candidateId)).run();
    expect(() => deps.db.update(financeImportCandidates).set({ decision: 'own' }).where(eq(financeImportCandidates.id, candidateId)).run()).toThrow(/permanent|immutable|once/);
  });
});

/**
 * F5 Task 1 — Regeln und Kontakt-IBANs sind Arbeitsmaterial: änderbar und
 * löschbar, aber eine Regel ohne jede Bedingung träfe jeden Umsatz. Das
 * sichert ein von Hand angefügter Trigger, nicht nur der Dienst.
 */
describe('finance_import_rules and finance_contact_bank_accounts', () => {
  const columns = (deps: Awaited<ReturnType<typeof fixtures>>['deps'], table: string) =>
    deps.db.all<{ name: string }>(sql.raw(`select name from pragma_table_info('${table}') order by cid`)).map((r) => r.name);
  const indexes = (deps: Awaited<ReturnType<typeof fixtures>>['deps'], table: string) =>
    deps.db.all<{ name: string; unique: number }>(sql.raw(`select name, "unique" from pragma_index_list('${table}') where origin = 'c' order by name`));
  const foreignTables = (deps: Awaited<ReturnType<typeof fixtures>>['deps'], table: string) =>
    deps.db.all<{ table: string }>(sql.raw(`select "table" from pragma_foreign_key_list('${table}')`)).map((r) => r.table).sort();

  it('has the rules and contact bank account tables with their indexes', async () => {
    const { deps } = await fixtures();
    expect(columns(deps, 'finance_import_rules')).toEqual([
      'id', 'name', 'sort_order', 'is_active',
      'account_id', 'direction', 'counterparty_iban', 'text_contains', 'amount_min_cents', 'amount_max_cents',
      'category_id', 'project_id', 'purpose_id', 'contact_id', 'tax_code', 'entry_text',
      'created_at', 'created_by_user_id', 'updated_at',
    ]);
    expect(columns(deps, 'finance_contact_bank_accounts')).toEqual(['id', 'contact_id', 'iban', 'created_at', 'created_by_user_id']);
    expect(indexes(deps, 'finance_contact_bank_accounts')).toEqual([
      { name: 'finance_contact_bank_accounts_iban_idx', unique: 0 },
      { name: 'finance_contact_bank_accounts_pair_idx', unique: 1 },
    ]);
    expect(indexes(deps, 'finance_import_rules')).toEqual([{ name: 'finance_import_rules_order_idx', unique: 0 }]);
    // Nie auf Kontoumsätze oder Kontakte (F4b-Lehre; Kontakte gehören einem anderen Modul); nur Kategorie und Zweck.
    expect(foreignTables(deps, 'finance_import_rules')).toEqual(['finance_categories', 'finance_purposes']);
    expect(foreignTables(deps, 'finance_contact_bank_accounts')).toEqual([]);

    const now = '2026-03-01T09:00:00.000Z';
    deps.db.insert(financeContactBankAccounts).values({ id: newId(), contactId: 'C1', iban: 'DE66999999991234567890', createdAt: now, createdByUserId: 'U1' }).run();
    expect(() => deps.db.insert(financeContactBankAccounts).values({ id: newId(), contactId: 'C1', iban: 'DE66999999991234567890', createdAt: now, createdByUserId: 'U1' }).run()).toThrow(/UNIQUE/);
    deps.db.insert(financeContactBankAccounts).values({ id: newId(), contactId: 'C2', iban: 'DE66999999991234567890', createdAt: now, createdByUserId: 'U1' }).run();
    deps.db.delete(financeContactBankAccounts).where(eq(financeContactBankAccounts.contactId, 'C2')).run();
  });

  it('refuses a rule without any condition on insert and on update (trigger)', async () => {
    const { deps, accountId, categoryId } = await fixtures();
    const now = '2026-03-01T09:00:00.000Z';
    const bare = { name: 'Alles', categoryId, createdAt: now, createdByUserId: 'U1', updatedAt: now };
    expect(() => deps.db.insert(financeImportRules).values({ id: newId(), ...bare }).run()).toThrow(/at least one condition/);

    // Jede Bedingung reicht für sich allein.
    for (const condition of [{ accountId }, { direction: 'in' as const }, { counterpartyIban: 'DE66999999991234567890' }, { textContains: 'bueromaterial' }, { amountMinCents: 100 }, { amountMaxCents: 900 }]) {
      deps.db.insert(financeImportRules).values({ id: newId(), ...bare, ...condition }).run();
    }

    const id = newId();
    deps.db.insert(financeImportRules).values({ id, ...bare, textContains: 'spende', amountMinCents: 100 }).run();
    deps.db.update(financeImportRules).set({ textContains: null }).where(eq(financeImportRules.id, id)).run();
    expect(() => deps.db.update(financeImportRules).set({ amountMinCents: null }).where(eq(financeImportRules.id, id)).run()).toThrow(/at least one condition/);
    // Arbeitsmaterial: änderbar und löschbar.
    deps.db.update(financeImportRules).set({ name: 'Spenden', isActive: false }).where(eq(financeImportRules.id, id)).run();
    deps.db.delete(financeImportRules).where(eq(financeImportRules.id, id)).run();
  });
});
