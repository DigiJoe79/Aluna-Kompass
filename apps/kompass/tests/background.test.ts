import { describe, expect, it } from 'vitest';
import { backgroundStarted, resetBackgroundForTests, startBackgroundWork, textWorker } from '@/lib/background';

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

  it('gibt den Worker heraus, sobald er läuft', () => {
    resetBackgroundForTests();
    const fake = { wake: () => {}, stop: () => {} };

    startBackgroundWork({ onStart: () => fake });

    expect(textWorker()).toBe(fake);
  });

  it('liefert ohne Start keinen Worker, statt zu werfen', () => {
    resetBackgroundForTests();

    expect(textWorker()).toBeNull();
  });
});
