import { describe, expect, it } from 'vitest';
import { seedClockAt, seedDaysAgo, seedMoment, storyDay } from '../src/seed/calendar';
import { createTestDeps } from '../src/testing';
import { todayIn } from '../src/today';

describe('seed calendar (Plan 2b)', () => {
  it('never hands out a moment after now', () => {
    const deps = createTestDeps({ now: '2026-09-05T08:00:00.000Z' });
    expect(seedMoment(deps, '2026-03-04').toISOString()).toBe('2026-03-04T09:00:00.000Z');
    expect(seedMoment(deps, '2026-09-05', '12:00').toISOString()).toBe('2026-09-05T08:00:00.000Z');
  });

  it('puts a story day into the story year, never after today — also on 2 January', () => {
    const deps = createTestDeps({ now: '2027-01-02T10:00:00.000Z' });
    const day = storyDay(deps, '03-04');
    expect(day <= todayIn(deps)).toBe(true);
    expect(day.slice(5)).toBe('03-04');
  });

  it('runs services under a clock fixed at the moment, without touching the original', () => {
    const deps = createTestDeps();
    const at = new Date('2026-02-10T09:00:00.000Z');
    expect(seedClockAt(deps, at).clock.now().toISOString()).toBe('2026-02-10T09:00:00.000Z');
    expect(deps.clock.now().toISOString()).toBe('2026-09-05T08:00:00.000Z');
    expect(seedDaysAgo(deps, 3)).toBe('2026-09-02');
  });
});
