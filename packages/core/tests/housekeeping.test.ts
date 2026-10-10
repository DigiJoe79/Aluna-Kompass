import { coreModule, defineModule, runHousekeeping, startHousekeeping } from '../src';
import { createTestDeps } from '../src/testing';
import { describe, expect, it, vi } from 'vitest';

describe('housekeeping', () => {
  it('calls the hook of every installed module, enabled or not, and reports a failing one without stopping', async () => {
    const calls: string[] = [];
    const a = defineModule({ key: 'eins', version: '0', permissions: [], housekeeping: async () => { calls.push('eins'); } });
    const b = defineModule({ key: 'zwei', version: '0', permissions: [], housekeeping: async () => { throw new Error('kaputt'); } });
    const c = defineModule({ key: 'drei', version: '0', permissions: [], housekeeping: async () => { calls.push('drei'); } });
    const deps = createTestDeps({ manifests: [coreModule, a, b, c] }); // kein Modul eingeschaltet
    expect(await runHousekeeping(deps)).toEqual([
      { module: 'eins', error: null },
      { module: 'zwei', error: 'kaputt' },
      { module: 'drei', error: null },
    ]);
    expect(calls).toEqual(['eins', 'drei']);
  });

  it('runs once at start, then on its interval, never twice at the same time, and stops after a running pass', async () => {
    vi.useFakeTimers();
    let runs = 0;
    let release!: () => void;
    const slow = defineModule({ key: 'langsam', version: '0', permissions: [], housekeeping: () => { runs += 1; return new Promise<void>((r) => { release = r; }); } });
    const deps = createTestDeps({ manifests: [coreModule, slow] });
    const keeper = startHousekeeping(() => deps, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(3000); // läuft noch → kein zweiter Durchlauf
    expect(runs).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);
    const stopping = keeper.stop();
    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(2);
    vi.useRealTimers();
  });
});
