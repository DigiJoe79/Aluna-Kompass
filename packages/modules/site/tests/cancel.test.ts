import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, schema as core, setModuleEnabled, unwrap } from '@kompass/core';
import { projectsModule } from '@kompass/module-projects';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTemplateSync, cancelSiteJob, lastSiteJob, listPublishes, runningSiteJob, siteModule, startPreview, startPublish } from '../src';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-cancel-'));
  dirs.push(d);
  return d;
};
const TEMPLATE_DIR = path.resolve(import.meta.dirname, '../../../../templates/verein-basis');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean, ms = 20_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(5)) if (fn()) return;
  throw new Error('Zeit um');
};

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: ['de', 'en'] });
  insertUser(deps, { id: 'USER-TEST' });
  unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'projects', enabled: true }));
  unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: TEMPLATE_DIR, confirm: true }));
  const env = {
    publicUrl: 'https://staging.example.org',
    staging: true,
    deploy: { host: '', user: '', path: tmp(), auth: { kind: 'none' as const } },
    templateDir: TEMPLATE_DIR,
    cacheDir: tmp(),
    previewDir: tmp(),
    workDir: tmp(),
  };
  return { deps, env, publish: ctxWith(['site.publish', 'site.view']) };
};
const started = (r: Awaited<ReturnType<typeof startPreview>>) => {
  const v = unwrap(r);
  if (!v.started) throw new Error('nicht gestartet');
  return v;
};
const settle = async (env: { cacheDir: string }) => {
  for (let i = 0; i < 4800 && runningSiteJob(env as never); i++) await sleep(50);
};
const audits = (deps: Awaited<ReturnType<typeof setup>>['deps'], action: string) => deps.db.select().from(core.auditLog).all().filter((e) => e.action === action);

describe('cancelSiteJob', () => {
  it('needs site.publish and a run id', async () => {
    const { deps, env, publish } = await setup();
    expect(cancelSiteJob(deps, ctxWith(['site.view']), env, { runId: 'R' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(cancelSiteJob(deps, publish, env, { runId: '' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(cancelSiteJob(deps, publish, env, { runId: 'R' })).toMatchObject({ ok: false, error: { code: 'jobNotRunning', messageKey: 'site.publish.job.errors.jobNotRunning' } });
  });

  it('cancels a preview, audits it, and frees the guard', async () => {
    const { deps, env, publish } = await setup();
    const run = started(await startPreview(deps, publish, env, { source: 'mcp' }));
    expect(cancelSiteJob(deps, publish, env, { runId: 'anderer' })).toMatchObject({ ok: false, error: { code: 'jobNotRunning' } });
    await until(() => runningSiteJob(env)?.steps.some((s) => s.state === 'running') ?? false);
    const step = runningSiteJob(env)!.steps.find((s) => s.state === 'running')!.key;
    expect(unwrap(cancelSiteJob(deps, publish, env, { runId: run.runId }))).toEqual({ cancelled: true });
    await settle(env);
    expect(unwrap(lastSiteJob(deps, publish, env, { kind: 'preview' })).last).toMatchObject({ status: 'aborted', reason: 'cancelled', lastStep: step, error: { code: 'jobCancelled' } });
    expect(audits(deps, 'site.jobCancel')).toHaveLength(1);
    expect(runningSiteJob(env)).toBeNull();
  }, 240_000);

  it('records a publish cancelled before the transfer as aborted', async () => {
    const { deps, env, publish } = await setup();
    const run = started(await startPublish(deps, publish, env, { confirm: true, source: 'ui' }));
    expect(unwrap(cancelSiteJob(deps, publish, env, { runId: run.runId }))).toEqual({ cancelled: true });
    await settle(env);
    const history = unwrap(await listPublishes(deps, publish, { environment: 'test' }));
    expect(history.map((h) => h.status)).toEqual(['aborted']);
    expect(history[0]!.summary).toContain('cancelled');
  }, 240_000);

  it('refuses while the transfer runs and still records success', async () => {
    const { deps, env, publish } = await setup();
    const bin = tmp();
    writeFileSync(path.join(bin, 'rsync'), '#!/bin/sh\nsleep 2\n');
    chmodSync(path.join(bin, 'rsync'), 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath}`;
    try {
      const run = started(await startPublish(deps, publish, env, { confirm: true, source: 'ui' }));
      await until(() => runningSiteJob(env)?.cancellable === false);
      expect(cancelSiteJob(deps, publish, env, { runId: run.runId })).toMatchObject({ ok: false, error: { code: 'jobNotCancellable' } });
      await settle(env);
    } finally {
      process.env.PATH = savedPath;
    }
    expect(unwrap(await listPublishes(deps, publish, { environment: 'test' })).map((h) => h.status)).toEqual(['success']);
  }, 240_000);

  it('has texts for every job error', () => {
    const de = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../../apps/kompass/messages/de.json'), 'utf8'));
    for (const code of ['jobNotRunning', 'jobNotCancellable', 'jobCancelled', 'stepTimedOut', 'jobInterrupted']) {
      expect(de.site.publish.job.errors[code], code).toMatchObject({ reason: expect.any(String), remedy: expect.any(String) });
    }
  });
});
