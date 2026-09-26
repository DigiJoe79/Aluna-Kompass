import { schema, unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { allocateEntryNumber, createFirstFiscalYear, ensureFiscalYearFor, fiscalYearForInternal, fiscalYearStatusInternal, listFiscalYears, updateFiscalYear } from '../src/ledger/fiscal-years';
import { financePeriodEvents } from '../src/schema';
import { setupFinance } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('fiscal years', () => {
  it('the first year is set up by a person; a short one is named as such; a second "first" is refused', async () => {
    const { deps, ctx } = setupFinance();
    expect(unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-09-01', endsOn: '2026-12-31' }))).toMatchObject({ designation: '2026 (Rumpfjahr)', status: 'open' });
    expect(err(await createFirstFiscalYear(deps, ctx, { startsOn: '2027-01-01', endsOn: '2027-12-31' }))).toMatchObject({ type: 'conflict', code: 'fiscalYearExists' });
  });

  it('refuses more than twelve months and an end before the start', async () => {
    const { deps, ctx } = setupFinance();
    expect(err(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2027-01-01' }))).toMatchObject({ type: 'validation', issues: [{ path: 'endsOn', message: 'fiscalYearTooLong' }] });
    expect(err(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-05-01', endsOn: '2026-04-30' }))).toMatchObject({ type: 'validation' });
  });

  it('ensureFiscalYearFor finds the year, creates only the immediate successor, and refuses everything else', async () => {
    const { deps, ctx } = setupFinance();
    const first = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-09-01', endsOn: '2026-12-31' }));
    const inTx = (date: string) => deps.db.transaction((tx) => ensureFiscalYearFor(tx, deps, ctx, date));
    expect(unwrap(inTx('2026-10-15')).id).toBe(first.id);
    // Befund 10 (Task 2): Grund und Abhilfe statt eines bloßen Codes — mit dem Datum und wer eines anlegen kann.
    expect(err(inTx('2026-08-31'))).toMatchObject({ type: 'conflict', code: 'noFiscalYearForDate', message: expect.stringContaining('2026-08-31') });
    expect(err(inTx('2028-01-01'))).toMatchObject({ type: 'conflict', code: 'noFiscalYearForDate' });
    const next = unwrap(inTx('2027-03-01'));
    expect(next).toMatchObject({ startsOn: '2027-01-01', endsOn: '2027-12-31', designation: '2027' });
    expect(unwrap(inTx('2027-12-31')).id).toBe(next.id);
    expect(deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.fiscalYear.autoCreate')).toHaveLength(1);
    expect(fiscalYearForInternal(deps.db, '2027-06-01')!.id).toBe(next.id);
  });

  it('a year that does not start in January keeps its rhythm', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-07-01', endsOn: '2027-06-30' }));
    expect(unwrap(deps.db.transaction((tx) => ensureFiscalYearFor(tx, deps, ctx, '2027-07-01')))).toMatchObject({ startsOn: '2027-07-01', endsOn: '2028-06-30', designation: '2027' });
  });

  it('numbers run per year without gaps, and lock the designation from the first one', async () => {
    const { deps, ctx } = setupFinance();
    const year = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
    unwrap(await updateFiscalYear(deps, ctx, { id: year.id, designation: 'GJ2026' }));
    expect(deps.db.transaction((tx) => [allocateEntryNumber(tx, year.id), allocateEntryNumber(tx, year.id)])).toEqual(['GJ2026-0001', 'GJ2026-0002']);
    expect(err(await updateFiscalYear(deps, ctx, { id: year.id, designation: 'Anders' }))).toMatchObject({ type: 'conflict', code: 'designationLocked' });
    expect(unwrap(await updateFiscalYear(deps, ctx, { id: year.id, taxReturnFiledOn: '2027-05-31' })).taxReturnFiledOn).toBe('2027-05-31');
  });

  it('the status is the latest event', async () => {
    const { deps, ctx, userId } = setupFinance();
    const year = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
    expect(fiscalYearStatusInternal(deps.db, year.id)).toBe('open');
    const event = (id: string, kind: 'closed' | 'reopened', at: string) => deps.db.insert(financePeriodEvents).values({ id, fiscalYearId: year.id, kind, at, byUserId: userId, reason: null }).run();
    event('E1', 'closed', '2027-02-01T10:00:00.000Z');
    expect(fiscalYearStatusInternal(deps.db, year.id)).toBe('closed');
    event('E2', 'reopened', '2027-03-01T10:00:00.000Z');
    expect(fiscalYearStatusInternal(deps.db, year.id)).toBe('open');
    expect(unwrap(await listFiscalYears(deps, ctx))[0]!.status).toBe('open');
  });
});
