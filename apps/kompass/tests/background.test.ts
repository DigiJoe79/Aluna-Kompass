import { describe, expect, it } from 'vitest';
import { backgroundStarted, resetBackgroundForTests, startBackgroundWork, stopBackgroundWork, textWorker } from '@/lib/background';

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

  it('hält den Worker an und kommt erst zurück, wenn dessen Durchlauf fertig ist', async () => {
    resetBackgroundForTests();
    let release!: () => void;
    const running = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = { wake: () => {}, stop: () => running };
    startBackgroundWork({ onStart: () => fake });

    let stopped = false;
    const stopping = stopBackgroundWork().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(textWorker()).toBeNull();
    expect(backgroundStarted()).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
  });
});
