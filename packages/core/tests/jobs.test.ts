import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../src/clock';
import {
  beginJob,
  endJob,
  JobAbortedError,
  jobRunningConflict,
  launchJob,
  readJobResult,
  requestJobCancel,
  runningJob,
  runStep,
  waitForJob,
  writeJsonAtomic,
  type JobSlot,
} from '../src/jobs';
import { ok, type Result } from '../src/result';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-jobs-'));
  dirs.push(d);
  return d;
};

let slot: JobSlot;
const clock = fixedClock('2026-10-23T10:00:00.000Z');
const init = (kind: string, runId: string, steps: string[] = ['x']) => ({ kind, steps, source: 'ui' as const, userId: 'U', runId });

beforeEach(() => {
  const root = tmp();
  slot = { key: `test:${root}`, dir: path.join(root, '.jobs'), workDir: root, tmpPrefix: '.work-' };
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Lauf-Mechanik', () => {
  it('nimmt einen Lauf und verweigert den zweiten ohne await dazwischen', () => {
    const a = beginJob(slot, clock, { kind: 'create', steps: ['x'], source: 'ui', userId: 'U', runId: 'R1' });
    const b = beginJob(slot, clock, { kind: 'verify', steps: ['x'], source: 'ui', userId: 'U', runId: 'R2' });
    expect('busy' in a).toBe(false);
    expect(b).toEqual({ busy: expect.objectContaining({ runId: 'R1', kind: 'create' }) });
    endJob(slot, 'R1');
    expect(runningJob(slot)).toBeNull();
  });

  it('schreibt Erfolg als Ergebnis je Art', async () => {
    const ok1 = launchJob(slot, clock, init('create', 'R1'), async () => ok({ n: 1 }));
    expect('done' in ok1).toBe(true);
    expect(await (ok1 as { done: Promise<Result<unknown>> }).done).toEqual(ok({ n: 1 }));
    expect(readJobResult(slot, 'create')).toMatchObject({ runId: 'R1', status: 'success', result: { n: 1 } });
    expect(runningJob(slot)).toBeNull();
  });

  it('schreibt einen Fachfehler als failed', async () => {
    const started = launchJob(slot, clock, init('create', 'R1'), async () => ({ ok: false, error: { type: 'notFound', entity: 'x', id: 'y' } }) as Result<never>);
    const result = await (started as { done: Promise<Result<unknown>> }).done;
    expect(result.ok).toBe(false);
    expect(readJobResult(slot, 'create')).toMatchObject({ status: 'failed', error: { type: 'notFound' } });
  });

  it('Abbruch: status aborted, reason cancelled, error jobCancelled', async () => {
    const started = launchJob(slot, clock, init('create', 'R1', ['a']), (h) =>
      runStep(h, 'a', { totalMs: 5_000, stallMs: 5_000 }, (c) => new Promise((_, reject) => c.signal.addEventListener('abort', () => reject(c.signal.reason)))),
    ) as { done: Promise<Result<unknown>> };
    await new Promise((r) => setTimeout(r, 5));
    expect(requestJobCancel(slot, 'R1')).toBe(true);
    const result = await started.done;
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code).toBe('jobCancelled');
    expect(readJobResult(slot, 'create')).toMatchObject({ status: 'aborted', reason: 'cancelled', lastStep: 'a', error: { code: 'jobCancelled' } });
  });

  it('Zeitgrenze gesamt: aborted, reason timeout, timeout.limitMs', async () => {
    const started = launchJob(slot, clock, init('create', 'R1', ['a']), (h) =>
      runStep(h, 'a', { totalMs: 20, stallMs: 1_000 }, (c) =>
        new Promise((_, reject) => {
          const t = setInterval(() => c.progress(1), 5);
          c.signal.addEventListener('abort', () => {
            clearInterval(t);
            reject(c.signal.reason);
          });
        }),
      ),
    ) as { done: Promise<Result<unknown>> };
    const result = await started.done;
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code).toBe('stepTimedOut');
    expect(readJobResult(slot, 'create')).toMatchObject({ status: 'aborted', reason: 'timeout', timeout: { limitMs: 20, stalled: false } });
  });

  it('Stillstand ohne progress: timeout.stalled', async () => {
    const started = launchJob(slot, clock, init('create', 'R1', ['a']), (h) =>
      runStep(h, 'a', { totalMs: 1_000, stallMs: 20 }, (c) => new Promise((_, reject) => c.signal.addEventListener('abort', () => reject(c.signal.reason)))),
    ) as { done: Promise<Result<unknown>> };
    await started.done;
    expect(readJobResult(slot, 'create')).toMatchObject({ status: 'aborted', reason: 'timeout', timeout: { limitMs: 20, stalled: true } });
  });

  it('Wurf: status failed mit <kind>Failed, done verwirft', async () => {
    const started = launchJob(slot, clock, init('create', 'R1'), async () => {
      throw new Error('kaputt');
    }) as { done: Promise<Result<unknown>> };
    await expect(started.done).rejects.toThrow('kaputt');
    expect(readJobResult(slot, 'create')).toMatchObject({ status: 'failed', error: { code: 'createFailed', message: 'kaputt' } });
    expect(runningJob(slot)).toBeNull();
  });

  it('macht aus einer fremden Riegeldatei einen unterbrochenen Lauf und räumt Arbeitsdateien', () => {
    mkdirSync(slot.dir, { recursive: true });
    writeJsonAtomic(path.join(slot.dir, 'running-job.json'), { runId: 'R9', kind: 'restore', startedAt: 't', steps: [{ key: 'replace', state: 'running' }], process: 'anderer', meta: { name: 'b' } });
    writeFileSync(path.join(slot.workDir, '.work-R9.tar.part'), 'x');
    mkdirSync(path.join(slot.workDir, '.work-dir'));
    writeFileSync(path.join(slot.workDir, 'bleibt.tar'), 'x');
    expect(runningJob(slot)).toBeNull();
    expect(readJobResult(slot, 'restore')).toMatchObject({ runId: 'R9', status: 'interrupted', lastStep: 'replace', meta: { name: 'b' }, error: { code: 'jobInterrupted' } });
    expect(existsSync(path.join(slot.workDir, '.work-R9.tar.part'))).toBe(false);
    expect(existsSync(path.join(slot.workDir, '.work-dir'))).toBe(false);
    expect(existsSync(path.join(slot.workDir, 'bleibt.tar'))).toBe(true);
    expect(existsSync(path.join(slot.dir, 'running-job.json'))).toBe(false);
  });

  it('waitForJob löst nach dem Ende mit dem Ergebnis auf, auch wenn der Lauf schon vorbei ist', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const started = launchJob(slot, clock, init('create', 'R1'), async () => {
      await gate;
      return ok('fertig');
    }) as { done: Promise<Result<unknown>> };
    const waiting = waitForJob(slot, 'R1');
    release();
    expect(await waiting).toMatchObject({ runId: 'R1', status: 'success', result: 'fertig' });
    await started.done;
    expect(await waitForJob(slot, 'R1')).toMatchObject({ runId: 'R1', status: 'success' });
    expect(await waitForJob(slot, 'anders')).toBeNull();
  });

  it('requestJobCancel verweigert bei cancellable=false und für fremde runId', () => {
    const h = beginJob(slot, clock, init('create', 'R1'));
    if ('busy' in h) throw new Error('busy');
    h.setCancellable(false);
    expect(requestJobCancel(slot, 'R1')).toBe(false);
    h.setCancellable(true);
    expect(requestJobCancel(slot, 'R2')).toBe(false);
    expect(requestJobCancel(slot, 'R1')).toBe(true);
    expect(h.signal.aborted).toBe(true);
    expect(h.signal.reason).toBeInstanceOf(JobAbortedError);
    endJob(slot, 'R1');
  });

  it('jobRunningConflict nennt die Art', () => {
    const h = beginJob(slot, clock, init('verify', 'R1'));
    if ('busy' in h) throw new Error('busy');
    const c = jobRunningConflict(h.run);
    expect(c.error).toMatchObject({ type: 'conflict', code: 'jobRunning', messageKey: 'jobs.errors.jobRunning', params: { kind: 'verify' } });
    endJob(slot, 'R1');
  });

  it('setMeta und progress landen im Laufzustand', () => {
    const h = beginJob(slot, clock, { ...init('create', 'R1', ['a', 'b']), meta: { backupKind: 'manual' } });
    if ('busy' in h) throw new Error('busy');
    h.begin('a');
    h.progress('a', 5, 10);
    h.setMeta({ name: 'n' });
    expect(runningJob(slot)).toMatchObject({ meta: { backupKind: 'manual', name: 'n' }, steps: [{ key: 'a', state: 'running', done: 5, total: 10 }, { key: 'b', state: 'pending' }] });
    endJob(slot, 'R1');
  });
});
