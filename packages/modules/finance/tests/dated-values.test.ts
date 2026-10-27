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
    expect(valueAt(deps.db, 'allowanceVolunteer', '2012-12-31')).toBeNull(); // vor dem ersten Eintrag: nichts erfinden
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
    expect(rate.entries).toEqual([{ validFrom: '2014-01-01', value: 30, source: 'shipped' }, { validFrom: '2027-01-01', value: 38, source: 'override' }]);
  });

  it('carries the history of the business threshold', () => {
    const { deps } = setupFinance();
    expect(valueAt(deps.db, 'thresholdBusiness', '2006-12-31')).toBeNull();
    expect(valueAt(deps.db, 'thresholdBusiness', '2007-01-01')).toBe(3_500_000);
    expect(valueAt(deps.db, 'thresholdBusiness', '2019-12-31')).toBe(3_500_000);
    expect(valueAt(deps.db, 'thresholdBusiness', '2020-01-01')).toBe(4_500_000);
    expect(valueAt(deps.db, 'thresholdBusiness', '2026-01-01')).toBe(5_000_000);
  });

  it('carries the history of the timely-use threshold', () => {
    const { deps } = setupFinance();
    expect(valueAt(deps.db, 'thresholdTimelyUse', '2020-12-31')).toBeNull();
    expect(valueAt(deps.db, 'thresholdTimelyUse', '2021-01-01')).toBe(4_500_000);
    expect(valueAt(deps.db, 'thresholdTimelyUse', '2026-01-01')).toBe(10_000_000);
  });

  it('carries allowance history', () => {
    const { deps } = setupFinance();
    expect(valueAt(deps.db, 'allowanceTrainer', '2020-06-30')).toBe(240_000);
    expect(valueAt(deps.db, 'allowanceTrainer', '2021-01-01')).toBe(300_000);
    expect(valueAt(deps.db, 'allowanceTrainer', '2026-01-01')).toBe(330_000);
    expect(valueAt(deps.db, 'allowanceVolunteer', '2020-06-30')).toBe(72_000);
    expect(valueAt(deps.db, 'allowanceVolunteer', '2021-01-01')).toBe(84_000);
    expect(valueAt(deps.db, 'allowanceVolunteer', '2026-01-01')).toBe(96_000);
  });

  it('knows the combined threshold only from 2026', () => {
    const { deps } = setupFinance();
    expect(valueAt(deps.db, 'thresholdAllBusinessCombined', '2025-12-31')).toBeNull();
    expect(valueAt(deps.db, 'thresholdAllBusinessCombined', '2026-01-01')).toBe(5_000_000);
  });

  it('knows the organ member liability limit', () => {
    const { deps } = setupFinance();
    expect(valueAt(deps.db, 'organMemberLiabilityLimit', '2021-01-01')).toBe(84_000);
    expect(valueAt(deps.db, 'organMemberLiabilityLimit', '2026-01-01')).toBe(330_000);
  });

  it('stores the free reserve share as an exact third', async () => {
    const { deps, ctx } = setupFinance();
    expect(valueAt(deps.db, 'freeReserveAssetShare', '2026-06-30')).toBe('1/3');
    expect(err(await setDatedValue(deps, ctx, { key: 'freeReserveAssetShare', validFrom: '2027-01-01', value: '2/5' }))).toBe('ok');
    expect(err(await setDatedValue(deps, ctx, { key: 'freeReserveAssetShare', validFrom: '2027-01-01', value: '5/3' }))).toMatchObject({ type: 'validation' });
    expect(err(await setDatedValue(deps, ctx, { key: 'freeReserveAssetShare', validFrom: '2027-01-01', value: '33' }))).toMatchObject({ type: 'validation' });
    expect(err(await setDatedValue(deps, ctx, { key: 'freeReserveAssetShare', validFrom: '2027-01-01', value: '1/0' }))).toMatchObject({ type: 'validation' });
  });

  it('checks the units of the VAT settings and lists their keys', async () => {
    const { deps, ctx } = setupFinance();
    const set = (key: string, value: unknown) => setDatedValue(deps, ctx, { key, validFrom: '2026-01-01', value });
    expect((await set('vatEntrepreneur', true)).ok).toBe(true);
    expect(err(await set('vatEntrepreneur', 'yes'))).toMatchObject({ type: 'validation' });
    expect((await set('vatAdvancePeriod', 'month')).ok).toBe(true);
    expect(err(await set('vatAdvancePeriod', 'year'))).toMatchObject({ type: 'validation' });
    expect((await set('taxOfficeState', 'NW')).ok).toBe(true);
    expect((await set('taxOfficeState', '')).ok).toBe(true);
    expect(err(await set('taxOfficeState', 'XX'))).toMatchObject({ type: 'validation' });
    expect((await set('vatId', 'DE123456788')).ok).toBe(true);
    expect((await set('vatId', '')).ok).toBe(true);
    expect(err(await set('vatId', 'DE123456789'))).toMatchObject({ type: 'validation' });
    const units = Object.fromEntries(unwrap(await listDatedValues(deps, ctx)).map((v) => [v.key, v.unit]));
    expect(units).toMatchObject({ vatEntrepreneur: 'flag', vatId: 'vatId', vatAdvancePeriod: 'vatAdvancePeriod', vatAdvanceExempt: 'flag', vatPermanentExtension: 'flag', taxOfficeState: 'federalState' });
  });

  it('starts the series on the day they are documented (Plan E6a Task 8)', () => {
    const { deps } = setupFinance();
    expect(valueAt(deps.db, 'mileageRate', '2014-06-01')).toBe(30);
    expect(valueAt(deps.db, 'mileageRate', '2013-12-31')).toBeNull();
    expect(valueAt(deps.db, 'waiverOneOffMonths', '2015-06-01')).toBe(3);
    expect(valueAt(deps.db, 'waiverClaimMonths', '2016-08-23')).toBe(3);
    expect(valueAt(deps.db, 'waiverClaimMonths', '2016-08-24')).toBe(12);
    expect(valueAt(deps.db, 'lateFinalizeCashDays', '2010-06-01')).toBe(1);
  });
});
