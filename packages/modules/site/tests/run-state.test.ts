import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixedClock } from '@kompass/core';
import { afterEach, describe, expect, it } from 'vitest';
import { beginRun, endRun, requestCancel, runningSiteJob, siteProcessToken, STEPS, type RunHandle, type SiteJobStep } from '../src/pipeline/run-state';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-rs-'));
  dirs.push(d);
  return d;
};
const env = () => ({ publicUrl: null, staging: false, deploy: null, templateDir: '/x', cacheDir: tmp(), previewDir: tmp(), workDir: tmp() });
const init = { kind: 'publish' as const, source: 'mcp' as const, userId: 'U1', runId: 'R1' };

describe('run state', () => {
  it('holds one run per cache, lists every step up front, mirrors it to the lock file', () => {
    const e = env();
    const clock = fixedClock('2026-10-02T10:00:00.000Z');
    const h = beginRun(e, clock, init) as RunHandle;
    expect(runningSiteJob(e)).toEqual({
      runId: 'R1',
      kind: 'publish',
      source: 'mcp',
      userId: 'U1',
      startedAt: '2026-10-02T10:00:00.000Z',
      cancellable: true,
      steps: STEPS.publish.map((key) => ({ key, state: 'pending' })),
    });
    expect(beginRun(e, clock, { ...init, runId: 'R2' })).toEqual({ busy: expect.objectContaining({ runId: 'R1' }) });
    h.begin('export');
    h.progress('export', 3, 10);
    h.finish('export');
    h.skip('build');
    h.setCancellable(false);
    const lock = JSON.parse(readFileSync(path.join(e.cacheDir, 'running-job.json'), 'utf8'));
    expect(lock).toMatchObject({ runId: 'R1', process: siteProcessToken(), cancellable: false });
    expect(lock.steps[0]).toMatchObject({ key: 'export', state: 'done', done: 3, total: 10 });
    expect(lock.steps.find((s: SiteJobStep) => s.key === 'build').state).toBe('skipped');
    expect(readdirSync(e.cacheDir).filter((f) => f.includes('.tmp'))).toEqual([]);
    endRun(e, 'R1');
    expect(runningSiteJob(e)).toBeNull();
    expect(existsSync(path.join(e.cacheDir, 'running-job.json'))).toBe(false);
  });

  it('cancels only a cancellable run with that id', () => {
    const e = env();
    const h = beginRun(e, fixedClock('2026-10-02T10:00:00.000Z'), init) as RunHandle;
    expect(requestCancel('R9')).toBe(false);
    h.setCancellable(false);
    expect(requestCancel('R1')).toBe(false);
    expect(h.signal.aborted).toBe(false);
    h.setCancellable(true);
    expect(requestCancel('R1')).toBe(true);
    expect(h.signal.aborted).toBe(true);
    endRun(e, 'R1');
  });

  it('turns a lock of another process into an interrupted result, clears it and the job dirs', () => {
    const e = env();
    mkdirSync(path.join(e.workDir, 'kompass-sitejob-site-abc'));
    mkdirSync(path.join(e.workDir, 'kompass-site-check-xyz')); // laufende Exportprüfung: bleibt
    writeFileSync(
      path.join(e.cacheDir, 'running-job.json'),
      JSON.stringify({
        runId: 'R1',
        kind: 'preview',
        source: 'ui',
        userId: 'U1',
        startedAt: '2026-10-02T10:00:00.000Z',
        updatedAt: '2026-10-02T10:03:00.000Z',
        cancellable: true,
        process: 'anderer-prozess',
        steps: [
          { key: 'export', state: 'done' },
          { key: 'images', state: 'running', done: 342, total: 1533 },
        ],
      }),
    );
    expect(runningSiteJob(e)).toBeNull();
    expect(JSON.parse(readFileSync(path.join(e.cacheDir, 'preview-result.json'), 'utf8'))).toMatchObject({
      runId: 'R1',
      status: 'interrupted',
      lastStep: 'images',
      finishedAt: '2026-10-02T10:03:00.000Z',
      error: { code: 'jobInterrupted' },
    });
    expect(existsSync(path.join(e.cacheDir, 'running-job.json'))).toBe(false);
    expect(readdirSync(e.workDir)).toEqual(['kompass-site-check-xyz']);
  });

  it('understands the lock file of 0.2.4', () => {
    const e = env();
    writeFileSync(path.join(e.cacheDir, 'running-job.json'), JSON.stringify({ name: 'publish', runId: 'R0', startedAt: '2026-10-01T10:00:00.000Z', process: 'alt' }));
    expect(runningSiteJob(e)).toBeNull();
    expect(JSON.parse(readFileSync(path.join(e.cacheDir, 'publish-result.json'), 'utf8'))).toMatchObject({ kind: 'publish', status: 'interrupted', historyPending: true });
  });
});
