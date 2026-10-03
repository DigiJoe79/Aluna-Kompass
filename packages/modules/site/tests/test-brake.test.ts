import { afterEach, describe, expect, it } from 'vitest';
import { siteTestBrake } from '../src/test-brake';

const set = (ms: number | undefined) => ((globalThis as { __kompassSiteTestBrakeMs?: number }).__kompassSiteTestBrakeMs = ms);
afterEach(() => set(undefined));
const took = async (fn: () => Promise<void>) => {
  const t0 = Date.now();
  await fn();
  return Date.now() - t0;
};

describe('siteTestBrake', () => {
  it('returns at once without a value', async () => {
    expect(await took(() => siteTestBrake({ env: 'test' }))).toBeLessThan(100);
  });
  it('does nothing outside the test environment, whatever is set', async () => {
    set(300);
    expect(await took(() => siteTestBrake({ env: 'production' }))).toBeLessThan(100);
    expect(await took(() => siteTestBrake({ env: 'development' }))).toBeLessThan(100);
  });
  it('waits in the test environment, and an abort ends the wait early', async () => {
    set(200);
    expect(await took(() => siteTestBrake({ env: 'test' }))).toBeGreaterThanOrEqual(190);
    set(5_000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    expect(await took(() => siteTestBrake({ env: 'test' }, controller.signal))).toBeLessThan(1_000);
  });
});
