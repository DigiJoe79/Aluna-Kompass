import { describe, expect, it } from 'vitest';
import { backgroundStarted, resetBackgroundForTests, startBackgroundWork } from '@/lib/background';

describe('startBackgroundWork', () => {
  it('startet einmal und bleibt beim zweiten Aufruf stumm', () => {
    resetBackgroundForTests();
    let starts = 0;

    startBackgroundWork({ onStart: () => (starts += 1) });
    startBackgroundWork({ onStart: () => (starts += 1) });

    expect(starts).toBe(1);
    expect(backgroundStarted()).toBe(true);
  });

  it('läuft im Edge-Zweig gar nicht an', () => {
    resetBackgroundForTests();
    let starts = 0;

    startBackgroundWork({ runtime: 'edge', onStart: () => (starts += 1) });

    expect(starts).toBe(0);
    expect(backgroundStarted()).toBe(false);
  });
});
