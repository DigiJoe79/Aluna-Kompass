import { newId } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { financeConfirmationRunItems, financeConfirmationRuns } from '../src/schema';
import { setupFinance } from './helpers';

/**
 * Der mechanische Wächter der Serienlauf-Tabellen (F6b Task 1): jede Regel
 * aus dem Plan gegen die echte Datenbank, roh über Drizzle — Muster
 * `donations-schema.test.ts`.
 */
type Deps = ReturnType<typeof setupFinance>['deps'];

function insertRun(deps: Deps, o: Partial<typeof financeConfirmationRuns.$inferInsert> = {}) {
  const id = o.id ?? newId();
  deps.db
    .insert(financeConfirmationRuns)
    .values({
      id, year: 2026, minCents: 0, excludedContactIds: '[]', startedOn: '2027-01-15', startedAt: '2027-01-15T09:00:00.000Z', startedByUserId: 'U1', startedChannel: 'ui',
      createdAt: '2027-01-15T09:00:00.000Z', ...o,
    })
    .run();
  return id;
}

function insertItem(deps: Deps, runId: string, o: Partial<typeof financeConfirmationRunItems.$inferInsert> = {}) {
  const id = o.id ?? newId();
  deps.db
    .insert(financeConfirmationRunItems)
    .values({ id, runId, contactId: 'CONTACT-1', kind: 'collective', lineIds: '["L1","L2"]', totalCents: 12000, needsSignature: false, state: 'pending', sortKey: 'musterspenderin', ...o })
    .run();
  return id;
}

describe('finance_confirmation_runs', () => {
  it('has the columns of the plan, with the facts of the start and three late facts', () => {
    const { deps } = setupFinance();
    const id = insertRun(deps, { followUpOfRunId: null });
    expect(deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, id)).get()).toEqual({
      id, year: 2026, minCents: 0, excludedContactIds: '[]', followUpOfRunId: null, startedOn: '2027-01-15', startedAt: '2027-01-15T09:00:00.000Z', startedByUserId: 'U1', startedChannel: 'ui',
      finishedAt: null, dispatchedAt: null, dispatchedVia: null, preNoticeReason: null, createdAt: '2027-01-15T09:00:00.000Z',
    });
  });

  it('is never deleted', () => {
    const { deps } = setupFinance();
    const id = insertRun(deps);
    expect(() => deps.db.delete(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, id)).run()).toThrow(/permanent/);
  });

  it('never changes its parameters or start facts', () => {
    const { deps } = setupFinance();
    const first = insertRun(deps);
    const id = insertRun(deps);
    for (const change of [{ year: 2025 }, { minCents: 1 }, { excludedContactIds: '["X"]' }, { followUpOfRunId: first }, { startedOn: '2027-01-16' }, { startedAt: 'x' }, { startedByUserId: 'U2' }, { startedChannel: 'mcp' }, { createdAt: 'x' }, { preNoticeReason: 'nachträglich' }]) {
      expect(() => deps.db.update(financeConfirmationRuns).set(change).where(eq(financeConfirmationRuns.id, id)).run(), JSON.stringify(change)).toThrow(/permanent/);
    }
  });

  it('sets finished and dispatched once each, from empty to a value', () => {
    const { deps } = setupFinance();
    const id = insertRun(deps);
    deps.db.update(financeConfirmationRuns).set({ finishedAt: '2027-01-15T09:05:00.000Z' }).where(eq(financeConfirmationRuns.id, id)).run();
    expect(() => deps.db.update(financeConfirmationRuns).set({ finishedAt: '2027-01-15T09:06:00.000Z' }).where(eq(financeConfirmationRuns.id, id)).run()).toThrow(/permanent/);
    expect(() => deps.db.update(financeConfirmationRuns).set({ finishedAt: null }).where(eq(financeConfirmationRuns.id, id)).run()).toThrow(/permanent/);
    deps.db.update(financeConfirmationRuns).set({ dispatchedAt: '2027-01-16', dispatchedVia: 'post' }).where(eq(financeConfirmationRuns.id, id)).run();
    expect(() => deps.db.update(financeConfirmationRuns).set({ dispatchedAt: '2027-01-17' }).where(eq(financeConfirmationRuns.id, id)).run()).toThrow(/permanent/);
    expect(() => deps.db.update(financeConfirmationRuns).set({ dispatchedVia: 'email' }).where(eq(financeConfirmationRuns.id, id)).run()).toThrow(/permanent/);
  });

  it('points a follow-up at an existing run', () => {
    const { deps } = setupFinance();
    expect(() => insertRun(deps, { followUpOfRunId: 'NO-SUCH-RUN' })).toThrow(/FOREIGN KEY/);
    insertRun(deps, { followUpOfRunId: insertRun(deps) });
  });
});

describe('finance_confirmation_run_items', () => {
  it('has the columns of the plan', () => {
    const { deps } = setupFinance();
    const runId = insertRun(deps);
    const id = insertItem(deps, runId, { kind: 'inKind', inKindLineId: 'L3', needsSignature: true });
    expect(deps.db.select().from(financeConfirmationRunItems).where(eq(financeConfirmationRunItems.id, id)).get()).toEqual({
      id, runId, contactId: 'CONTACT-1', kind: 'inKind', inKindLineId: 'L3', lineIds: '["L1","L2"]', totalCents: 12000, needsSignature: true, state: 'pending',
      confirmationId: null, errorCode: null, doneAt: null, sortKey: 'musterspenderin',
    });
  });

  it('belongs to an existing run', () => {
    const { deps } = setupFinance();
    expect(() => insertItem(deps, 'NO-SUCH-RUN')).toThrow(/FOREIGN KEY/);
  });

  it('is unique per run, contact, kind and in-kind line — also without an in-kind line', () => {
    const { deps } = setupFinance();
    const runId = insertRun(deps);
    insertItem(deps, runId);
    // SQLite hält NULL in einem Unique-Index für verschieden; ohne den partiellen Index gäbe es hier zwei Sammelposten.
    expect(() => insertItem(deps, runId)).toThrow(/UNIQUE/);
    insertItem(deps, runId, { kind: 'collectiveWaiver' });
    insertItem(deps, runId, { contactId: 'CONTACT-2' });
    insertItem(deps, runId, { kind: 'inKind', inKindLineId: 'L3' });
    expect(() => insertItem(deps, runId, { kind: 'inKind', inKindLineId: 'L3' })).toThrow(/UNIQUE/);
    insertItem(deps, runId, { kind: 'inKind', inKindLineId: 'L4' });
    insertItem(deps, insertRun(deps));
  });

  it('is never deleted', () => {
    const { deps } = setupFinance();
    const id = insertItem(deps, insertRun(deps));
    expect(() => deps.db.delete(financeConfirmationRunItems).where(eq(financeConfirmationRunItems.id, id)).run()).toThrow(/permanent/);
  });

  it('never changes what was snapshotted at the start', () => {
    const { deps } = setupFinance();
    const runId = insertRun(deps);
    const id = insertItem(deps, runId);
    const otherRun = insertRun(deps);
    for (const change of [{ runId: otherRun }, { contactId: 'CONTACT-2' }, { kind: 'collectiveWaiver' as const }, { inKindLineId: 'L9' }, { lineIds: '[]' }, { totalCents: 1 }, { needsSignature: true }, { sortKey: 'x' }]) {
      expect(() => deps.db.update(financeConfirmationRunItems).set(change).where(eq(financeConfirmationRunItems.id, id)).run(), JSON.stringify(change)).toThrow(/permanent/);
    }
  });

  it('leaves pending once: issued with its confirmation, or failed with its code, and stays', () => {
    const { deps } = setupFinance();
    const runId = insertRun(deps);
    const issued = insertItem(deps, runId);
    deps.db.update(financeConfirmationRunItems).set({ state: 'issued', confirmationId: 'C1', doneAt: '2027-01-15T09:01:00.000Z' }).where(eq(financeConfirmationRunItems.id, issued)).run();
    for (const change of [{ state: 'pending' as const }, { state: 'failed' as const }, { confirmationId: 'C2' }, { errorCode: 'x' }, { doneAt: null }]) {
      expect(() => deps.db.update(financeConfirmationRunItems).set(change).where(eq(financeConfirmationRunItems.id, issued)).run(), JSON.stringify(change)).toThrow(/permanent/);
    }

    const failed = insertItem(deps, runId, { contactId: 'CONTACT-2' });
    deps.db.update(financeConfirmationRunItems).set({ state: 'failed', errorCode: 'noNoticeValidAt', doneAt: '2027-01-15T09:02:00.000Z' }).where(eq(financeConfirmationRunItems.id, failed)).run();
    expect(() => deps.db.update(financeConfirmationRunItems).set({ state: 'issued', confirmationId: 'C3' }).where(eq(financeConfirmationRunItems.id, failed)).run()).toThrow(/permanent/);

    // Übersprungen wird schon beim Anlegen (Anschrift fehlt) — auch das bleibt.
    const skipped = insertItem(deps, runId, { contactId: 'CONTACT-3', state: 'skipped', errorCode: 'contactComplete', doneAt: '2027-01-15T09:00:00.000Z' });
    expect(() => deps.db.update(financeConfirmationRunItems).set({ state: 'pending', errorCode: null }).where(eq(financeConfirmationRunItems.id, skipped)).run()).toThrow(/permanent/);
  });
});
