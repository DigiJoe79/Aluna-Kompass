import { describe, expect, it } from 'vitest';
import { writeSettingInternal } from '../src/settings/service';
import { createTestDeps, systemContext } from '../src/testing';
import { isoDayIn, todayIn, yearIn } from '../src/today';

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
