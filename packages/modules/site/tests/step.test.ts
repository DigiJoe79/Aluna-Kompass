import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixedClock } from '@kompass/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginRun, endRun, requestCancel, runningSiteJob, type RunHandle } from '../src/pipeline/run-state';
import { removeQuietly, step } from '../src/pipeline/step';
import { copyImagesIfAny } from '../src/pipeline/jobs';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-step-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(d, 0o700);
    } catch {
      // schon weg
    }
    rmSync(d, { recursive: true, force: true });
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitForAbort = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));

let env: ReturnType<typeof makeEnv>;
let h: RunHandle;
const makeEnv = () => ({ publicUrl: null, staging: false, deploy: null, templateDir: '/x', cacheDir: tmp(), previewDir: tmp(), workDir: tmp() });
beforeEach(() => {
  env = makeEnv();
  h = beginRun(env, fixedClock('2026-10-02T10:00:00.000Z'), { kind: 'publish', source: 'ui', userId: 'U', runId: 'R1' }) as RunHandle;
});
afterEach(() => endRun(env, 'R1'));

describe('step', () => {
  it('startAs skipped shows the step as skipped from the first moment, while its work still counts', async () => {
    const seen: unknown[] = [];
    await step(h, 'build', { totalMs: 5_000, stallMs: 5_000 }, async (c) => {
      c.progress(3, 10);
      seen.push(structuredClone(runningSiteJob(env)!.steps.find((x) => x.key === 'build')));
    }, { startAs: 'skipped' });
    expect(seen).toEqual([expect.objectContaining({ key: 'build', state: 'skipped', done: 3, total: 10 })]);
    expect(runningSiteJob(env)!.steps.find((x) => x.key === 'build')!.state).toBe('skipped');
  });
  it('on timeout waits until the work has really stopped', async () => {
    let finished = false;
    const t0 = performance.now();
    const p = step(h, 'images', { totalMs: 20, stallMs: 10_000 }, async () => {
      await sleep(150);
      finished = true;
    });
    await expect(p).rejects.toMatchObject({ name: 'JobAbortedError', reason: 'timeout', step: 'images' });
    expect(finished).toBe(true);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(140);
  });

  it('names the limit and whether it was the total or the standstill', async () => {
    await expect(step(h, 'images', { totalMs: 20, stallMs: 10_000 }, (c) => waitForAbort(c.signal))).rejects.toMatchObject({ limit: { ms: 20, stalled: false } });
    await expect(step(h, 'export', { totalMs: 10_000, stallMs: 50 }, (c) => waitForAbort(c.signal))).rejects.toMatchObject({ limit: { ms: 50, stalled: true } });
  });

  it('treats a counter that stands still as a timeout', async () => {
    await expect(step(h, 'export', { totalMs: 10_000, stallMs: 50 }, (c) => waitForAbort(c.signal))).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('keeps a step alive while it moves', async () => {
    await expect(
      step(h, 'export', { totalMs: 10_000, stallMs: 100 }, async (c) => {
        for (let i = 1; i <= 10; i++) {
          await sleep(30);
          c.progress(i, 10);
        }
        return 'ok';
      }),
    ).resolves.toBe('ok');
    expect(runningSiteJob(env)!.steps[0]).toMatchObject({ state: 'done', done: 10, total: 10 });
  });

  it('stops on cancel', async () => {
    const p = step(h, 'export', { totalMs: 10_000, stallMs: 10_000 }, (c) => waitForAbort(c.signal));
    requestCancel(h.run.runId);
    await expect(p).rejects.toMatchObject({ reason: 'cancelled', step: 'export' });
  });

  it('removes quietly and keeps the real error', async () => {
    const parent = tmp();
    const child = path.join(parent, 'kind');
    mkdirSync(child);
    writeFileSync(path.join(child, 'datei'), 'x');
    chmodSync(parent, 0o500);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(removeQuietly(child)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('copies images only when there are any', async () => {
    await expect(copyImagesIfAny(path.join(tmp(), 'fehlt'), tmp())).resolves.toBeUndefined();
    const file = path.join(tmp(), 'datei');
    writeFileSync(file, 'x');
    await expect(copyImagesIfAny(file, tmp())).rejects.toThrow();
  });
});
