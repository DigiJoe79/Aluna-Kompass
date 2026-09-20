import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { DATED_SERIES } from '../src/ledger/dated-series';
import { listDatedValues, removeDatedValue, setDatedValue, valueAt } from '../src/ledger/dated-values';
import { setupFinance } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('dated values', () => {
  it('ships a series for every key, sorted, and answers by date', () => {
    const { deps } = setupFinance();
    for (const [key, { series }] of Object.entries(DATED_SERIES)) expect([...series].map((e) => e.validFrom), key).toEqual([...series].map((e) => e.validFrom).sort());
    expect(valueAt(deps.db, 'allowanceVolunteer', '2026-03-01')).toBe(96000);
    expect(valueAt(deps.db, 'allowanceVolunteer', '2025-12-31')).toBeNull(); // vor dem ersten Eintrag: nichts erfinden
    expect(valueAt(deps.db, 'taxation', '2026-09-21')).toBe('smallBusiness');
  });

  it('an override of the association wins from its date on, and only from then', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await setDatedValue(deps, ctx, { key: 'taxation', validFrom: '2026-10-14', value: 'regular' }));
    expect(valueAt(deps.db, 'taxation', '2026-10-13')).toBe('smallBusiness');
    expect(valueAt(deps.db, 'taxation', '2026-10-14')).toBe('regular');
    unwrap(await setDatedValue(deps, ctx, { key: 'mileageRate', validFrom: '2026-01-01', value: 25 })); // derselbe Stichtag wie die Reihe
    expect(valueAt(deps.db, 'mileageRate', '2026-06-01')).toBe(25);
    unwrap(await removeDatedValue(deps, ctx, { key: 'mileageRate', validFrom: '2026-01-01' }));
    expect(valueAt(deps.db, 'mileageRate', '2026-06-01')).toBe(30);
  });

  it('checks key, unit and right', async () => {
    const { deps, ctx } = setupFinance();
    expect(err(await setDatedValue(deps, ctxWith(['finance.read']), { key: 'mileageRate', validFrom: '2026-01-01', value: 25 }))).toEqual({ type: 'forbidden', permission: 'finance.setup' });
    expect(err(await setDatedValue(deps, ctx, { key: 'nope', validFrom: '2026-01-01', value: 1 }))).toMatchObject({ type: 'validation' });
    expect(err(await setDatedValue(deps, ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'sometimes' }))).toMatchObject({ type: 'validation' });
    expect(err(await setDatedValue(deps, ctx, { key: 'warnAtPercent', validFrom: '2026-01-01', value: 140 }))).toMatchObject({ type: 'validation' });
    expect(err(await setDatedValue(deps, ctx, { key: 'mileageRate', validFrom: '2026-01-01', value: -3 }))).toMatchObject({ type: 'validation' });
    expect(err(await removeDatedValue(deps, ctx, { key: 'mileageRate', validFrom: '2026-01-01' }))).toMatchObject({ type: 'notFound' });
  });

  it('lists shipped and overridden entries side by side', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await setDatedValue(deps, ctx, { key: 'mileageRate', validFrom: '2027-01-01', value: 38 }));
    const rate = unwrap(await listDatedValues(deps, ctx)).find((v) => v.key === 'mileageRate')!;
    expect(rate.entries).toEqual([{ validFrom: '2026-01-01', value: 30, source: 'shipped' }, { validFrom: '2027-01-01', value: 38, source: 'override' }]);
  });
});
