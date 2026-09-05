import { describe, expect, it } from 'vitest';
import { fixedClock, isoNow, systemClock } from '../src/clock';

describe('clock', () => {
  it('fixedClock returns the same instant until advanced', () => {
    const clock = fixedClock('2026-09-05T08:00:00.000Z');
    expect(isoNow(clock)).toBe('2026-09-05T08:00:00.000Z');
    clock.advance(60_000);
    expect(isoNow(clock)).toBe('2026-09-05T08:01:00.000Z');
  });

  it('fixedClock hands out copies, not the internal Date', () => {
    const clock = fixedClock('2026-09-05T08:00:00.000Z');
    clock.now().setFullYear(2000);
    expect(isoNow(clock)).toBe('2026-09-05T08:00:00.000Z');
  });

  it('systemClock is close to Date.now', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
