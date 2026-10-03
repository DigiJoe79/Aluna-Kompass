import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { schema, unwrap } from '@kompass/core';
import { describe, expect, it, vi } from 'vitest';
import { sitePublishes } from '../src/schema';

const fake = vi.hoisted(() => ({ run: null as unknown }));
vi.mock('../src/pipeline/run-state', async (orig) => ({ ...(await orig<object>()), runningSiteJob: () => fake.run }));
const { siteJobOverview, siteJobResult, tailLog, trimPaths } = await import('../src/services/job-view');

const files = (n: number) => Array.from({ length: n }, (_, i) => `_astro/bilder/hund-${String(i).padStart(4, '0')}-1200.abcdef12.webp`);
const env = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'job-view-'));
  return { publicUrl: null, staging: true, deploy: null, templateDir: d, cacheDir: d, previewDir: d };
};
const write = (e: { cacheDir: string }, kind: string, record: object) => writeFileSync(path.join(e.cacheDir, `${kind}-result.json`), JSON.stringify(record));
const base = { runId: 'R1', startedAt: '2026-10-02T08:00:00.000Z', finishedAt: '2026-10-02T08:05:00.000Z', userId: 'U1' };
const preview = {
  contentHash: 'h'.repeat(64),
  gaps: [],
  violations: [{ path: 'variables.claim', term: 'Popescu', excerpt: '…' }],
  stale: [],
  pendingReview: [],
  diff: { changed: files(2000), added: files(30), removed: [] },
  previewDir: '/x',
  log: 'z'.repeat(50_000),
  skippedImages: [{ assetId: 'A1', filename: 'kaputt.png', reason: 'decodeFailed' }],
};
const ctx = ctxWith(['site.publish', 'site.view'], 'U1');

describe('trimPaths / tailLog', () => {
  it('keeps the first 20 and says how many there are', () => {
    expect(trimPaths(files(25))).toEqual({ items: files(20), total: 25, truncated: true });
    expect(trimPaths(files(3))).toEqual({ items: files(3), total: 3, truncated: false });
    expect(trimPaths(undefined)).toEqual({ items: [], total: 0, truncated: false });
    expect(trimPaths(files(25), Infinity).items).toHaveLength(25);
  });
  it('keeps the last 2000 characters of a log', () => {
    expect(tailLog('a'.repeat(10) + 'b'.repeat(2000))).toEqual({ text: 'b'.repeat(2000), truncated: true });
    expect(tailLog(undefined)).toEqual({ text: '', truncated: false });
  });
});

describe('siteJobOverview / siteJobResult', () => {
  it('needs site.publish', () => {
    const deps = createTestDeps();
    expect(siteJobOverview(deps, ctxWith(['site.view']), env())).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(siteJobResult(deps, ctxWith(['site.view']), env(), { kind: 'preview' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
  it('summarises the last run of each kind with counts, name and no lists', () => {
    const deps = createTestDeps();
    insertUser(deps, { id: 'U1', name: 'Erika Beispiel' });
    const e = env();
    write(e, 'preview', { kind: 'preview', ...base, status: 'success', result: preview });
    const { last } = unwrap(siteJobOverview(deps, ctx, e));
    expect(last.preview).toMatchObject({
      status: 'success',
      userName: 'Erika Beispiel',
      contentHash: preview.contentHash,
      superseded: false,
      counts: { changed: 2000, added: 30, removed: 0, violations: 1, gaps: 0, stale: 0, pendingReview: 0, skippedImages: 1 },
    });
    expect(JSON.stringify(last.preview)).not.toContain('hund-0001');
    expect(last.publish).toBeNull();
  });
  it('reads a 0.2.4 record without status and marks a preview superseded by a later publish', () => {
    const deps = createTestDeps();
    const e = env();
    write(e, 'preview', { kind: 'preview', ...base, result: { contentHash: 'h' } });
    write(e, 'deployCheck', { kind: 'deployCheck', ...base, error: { type: 'conflict', code: 'deployCheckFailed', message: 'x' } });
    deps.db.insert(sitePublishes).values({ id: 'P1', environment: deps.env, startedAt: '2026-10-02T09:00:00.000Z', status: 'success' }).run();
    const { last } = unwrap(siteJobOverview(deps, ctx, e));
    expect(last.preview).toMatchObject({ status: 'success', superseded: true, counts: { changed: 0 } });
    expect(last.deployCheck).toMatchObject({ status: 'failed', error: { code: 'deployCheckFailed' } });
  });
  it('gives details trimmed by default and in full on request', () => {
    const deps = createTestDeps();
    const e = env();
    write(e, 'preview', { kind: 'preview', ...base, status: 'success', result: preview });
    const short = unwrap(siteJobResult(deps, ctx, e, { kind: 'preview' })).last!;
    expect(short.diff!.changed).toMatchObject({ total: 2000, truncated: true });
    expect(short.diff!.changed.items).toHaveLength(20);
    expect(short.violations).toHaveLength(1);
    expect(short.skippedImages).toMatchObject({ total: 1, items: ['kaputt.png'] });
    expect(short.log.text).toHaveLength(2000);
    const full = unwrap(siteJobResult(deps, ctx, e, { kind: 'preview', paths: 'all', log: 'full' })).last!;
    expect(full.diff!.changed.items).toHaveLength(2000);
    expect(full.log.text).toHaveLength(50_000);
  });
  it('reports the running job with elapsed time from the server clock', () => {
    const deps = createTestDeps({ now: '2026-10-02T08:01:30.000Z' });
    insertUser(deps, { id: 'U1', name: 'Erika Beispiel' });
    fake.run = { runId: 'R2', kind: 'preview', source: 'mcp', userId: 'U1', startedAt: '2026-10-02T08:00:00.000Z', cancellable: true, steps: [{ key: 'images', state: 'running', done: 342, total: 1533 }] };
    expect(unwrap(siteJobOverview(deps, ctx, env())).running).toMatchObject({ runId: 'R2', elapsedMs: 90_000, userName: 'Erika Beispiel' });
    fake.run = null;
  });
  it('names the API token the running job was started with', () => {
    const deps = createTestDeps({ now: '2026-10-02T08:01:30.000Z' });
    insertUser(deps, { id: 'U1', name: 'Erika Beispiel' });
    deps.db.insert(schema.apiTokens).values({ id: 'T1', userId: 'U1', name: 'Hundeblicke-Sync', prefix: 'dev_abc', tokenHash: 'x', createdAt: '2026-10-01T00:00:00.000Z' }).run();
    fake.run = { runId: 'R3', kind: 'preview', source: 'mcp', userId: 'U1', apiTokenId: 'T1', startedAt: '2026-10-02T08:00:00.000Z', cancellable: true, steps: [] };
    expect(unwrap(siteJobOverview(deps, ctx, env())).running).toMatchObject({ tokenName: 'Hundeblicke-Sync' });
    fake.run = { runId: 'R4', kind: 'preview', source: 'ui', userId: 'U1', startedAt: '2026-10-02T08:00:00.000Z', cancellable: true, steps: [] };
    expect(unwrap(siteJobOverview(deps, ctx, env())).running).toMatchObject({ tokenName: null });
    fake.run = null;
  });
  it('refuses an unknown kind', () => {
    expect(siteJobResult(createTestDeps(), ctx, env(), { kind: 'deploy' } as never)).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('end states and deploy check verdict', () => {
  const deps = createTestDeps();
  insertUser(deps, { id: 'U1', name: 'Erika Beispiel' });
  const checks = [
    { key: 'connect', outcome: 'skipped' },
    { key: 'targetDir', outcome: 'failed', problem: 'targetMissing' },
    { key: 'writable', outcome: 'notRun' },
    { key: 'targetFiles', outcome: 'notRun' },
  ];
  it('summarizes a deploy check by its verdict and lists the four checks', () => {
    const e = env();
    write(e, 'deployCheck', { ...base, kind: 'deployCheck', status: 'success', result: { target: '/ziel', passed: false, checks, filesAtTarget: [], log: '' } });
    const last = unwrap(siteJobResult(deps, ctx, e, { kind: 'deployCheck' })).last!;
    expect(last.passed).toBe(false);
    expect(last.checks?.[1]).toEqual({ key: 'targetDir', outcome: 'failed', problem: 'targetMissing' });
    expect(last.diff).toBeUndefined();
    expect(unwrap(siteJobOverview(deps, ctx, e)).last.deployCheck!.passed).toBe(false);
  });
  it('reads an old deploy check result without checks', () => {
    const e = env();
    write(e, 'deployCheck', { ...base, kind: 'deployCheck', status: 'success', result: { target: '/z', filesAtTarget: ['a'], publishWould: { changed: [], added: [], removed: [] }, build: { ok: true }, log: '' } });
    const last = unwrap(siteJobResult(deps, ctx, e, { kind: 'deployCheck' })).last!;
    expect(last.passed).toBeUndefined();
    expect(last.checks).toBeUndefined();
    expect(last.diff).toBeUndefined();
  });
  it('carries the limit and the counter of a timed-out step', () => {
    const e = env();
    write(e, 'preview', { ...base, kind: 'preview', status: 'aborted', reason: 'timeout', lastStep: 'images', timeout: { limitMs: 1_800_000, stalled: false }, steps: [{ key: 'images', state: 'running', done: 342, total: 1533 }] });
    const s = unwrap(siteJobOverview(deps, ctx, e)).last.preview!;
    expect(s.timeout).toEqual({ limitMs: 1_800_000, stalled: false });
    expect(s.stoppedAt).toEqual({ done: 342, total: 1533 });
  });
  it.each([
    [{ type: 'conflict', code: 'publishFailed', message: 'rsync exited with 255\nPermission denied (publickey).' }, 'authFailed'],
    [{ type: 'conflict', code: 'siteBuildFailed', message: 'x' }, 'build'],
    [{ type: 'conflict', code: 'previewOutdated', message: 'x' }, 'previewOutdated'],
    [{ type: 'conflict', code: 'blockedTermsPresent', message: 'x' }, 'blockedTerms'],
  ])('classifies a failed publish %#', (error, failure) => {
    const e = env();
    write(e, 'publish', { ...base, kind: 'publish', status: 'failed', error });
    expect(unwrap(siteJobOverview(deps, ctx, e)).last.publish!.failure).toBe(failure);
  });
});
