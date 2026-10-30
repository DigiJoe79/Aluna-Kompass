import { describe, expect, it } from 'vitest';
import { writeSettingInternal } from '../src/settings/service';
import { createTestDeps, systemContext } from '../src/testing';
import { isoDayIn, todayIn, yearIn, zonedDayStartIso } from '../src/today';
import { isoDay } from '../src/dates';

describe('todayIn (A4)', () => {
  it('returns the local date of the association time zone', () => {
    const deps = createTestDeps({ now: '2026-12-31T23:30:00.000Z' });
    expect(todayIn(deps)).toBe('2027-01-01');
  });

  it('yearIn: am 1.1. um 00:30 Uhr Ortszeit ist schon das neue Jahr (Befund 46)', () => {
    const deps = createTestDeps({ now: '2026-12-31T23:30:00.000Z' });
    expect(yearIn(deps)).toBe(2027);
  });

  it('follows the time zone the association sets', () => {
    const deps = createTestDeps({ now: '2026-12-31T23:30:00.000Z' });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.timeZone', 'America/New_York'));
    expect(todayIn(deps)).toBe('2026-12-31');
  });

  it('gives the local day of any instant, in summer time too', () => {
    const deps = createTestDeps();
    expect(isoDayIn(deps, new Date('2026-06-30T22:30:00.000Z'))).toBe('2026-07-01');
    expect(isoDayIn(deps, Date.parse('2026-06-30T21:30:00.000Z'))).toBe('2026-06-30');
  });

  it('refuses a time zone that does not exist', () => {
    const deps = createTestDeps();
    const res = deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.timeZone', 'Europe/Atlantis'));
    expect(res.ok).toBe(false);
  });
});

describe('zonedDayStartIso (F-B3, 0.4.5)', () => {
  it('gives 00:00 of the day in the association time zone as a UTC timestamp — winter and summer', () => {
    const deps = createTestDeps();
    expect(zonedDayStartIso(deps, isoDay('2027-01-01'))).toBe('2026-12-31T23:00:00.000Z');
    expect(zonedDayStartIso(deps, isoDay('2026-07-01'))).toBe('2026-06-30T22:00:00.000Z');
  });

  it('is right on the days the clocks change', () => {
    const deps = createTestDeps();
    expect(zonedDayStartIso(deps, isoDay('2026-03-29'))).toBe('2026-03-28T23:00:00.000Z');
    expect(zonedDayStartIso(deps, isoDay('2026-03-30'))).toBe('2026-03-29T22:00:00.000Z');
    expect(zonedDayStartIso(deps, isoDay('2026-10-25'))).toBe('2026-10-24T22:00:00.000Z');
    expect(zonedDayStartIso(deps, isoDay('2026-10-26'))).toBe('2026-10-25T23:00:00.000Z');
  });

  it('follows the time zone the association sets, and is the inverse of isoDayIn', () => {
    const deps = createTestDeps();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.timeZone', 'America/New_York'));
    expect(zonedDayStartIso(deps, isoDay('2027-01-01'))).toBe('2027-01-01T05:00:00.000Z');
    const start = zonedDayStartIso(deps, isoDay('2026-11-01'));
    expect(isoDayIn(deps, new Date(start))).toBe('2026-11-01');
    expect(isoDayIn(deps, new Date(Date.parse(start) - 1))).toBe('2026-10-31');
  });
});
