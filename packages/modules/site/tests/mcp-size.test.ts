import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { moduleMcpTools } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { sitePublishes } from '../src/schema';

const fake = vi.hoisted(() => ({ env: null as unknown }));
vi.mock('../src/pipeline/env', async (orig) => ({ ...(await orig<object>()), readSiteEnv: () => fake.env }));
vi.mock('../src/pipeline/run-state', async (orig) => ({
  ...(await orig<object>()),
  runningSiteJob: () => ({
    runId: 'R9',
    kind: 'publish',
    source: 'mcp',
    userId: 'U1',
    startedAt: '2026-10-02T08:00:00.000Z',
    cancellable: true,
    steps: ['export', 'images', 'build', 'copyImages', 'checksums', 'transfer', 'record'].map((key, i) => ({ key, state: i < 2 ? 'done' : 'pending', done: 342, total: 1533, startedAt: '2026-10-02T08:00:00.000Z' })),
  }),
}));
const { siteModule } = await import('../src/manifest');

const files = (n: number) => Array.from({ length: n }, (_, i) => `_astro/bilder/hund-${String(i).padStart(4, '0')}-1200.abcdef12.webp`);
const gap = (i: number) => ({ path: `collections.dogs.hund-${i}.story`, locale: 'en' });
const stale = (i: number) => ({ path: `collections.dogs.hund-${i}.photo`, value: `01ARZ3NDEKTSV4RRFFQ69G5F${String(i).padStart(2, '0')}` });
const pending = (i: number) => ({ view: 'animals', label: `Hund Nummer ${i}`, href: `/animals/01ARZ3NDEKTSV4RRFFQ69G5F${String(i).padStart(2, '0')}` });
const common = {
  contentHash: 'h'.repeat(64),
  gaps: Array.from({ length: 25 }, (_, i) => gap(i)),
  violations: [1, 2, 3].map((i) => ({ path: `variables.claim${i}`, term: 'Popescu', excerpt: 'ein Satz mit dem Treffer mittendrin und etwas Kontext davor und danach' })),
  stale: Array.from({ length: 25 }, (_, i) => stale(i)),
  pendingReview: Array.from({ length: 25 }, (_, i) => pending(i)),
  diff: { changed: files(2000), added: files(2000), removed: files(2000) },
  log: 'z'.repeat(50_000),
  skippedImages: [],
};
const base = { runId: 'R1', startedAt: '2026-10-02T08:00:00.000Z', finishedAt: '2026-10-02T08:05:00.000Z', userId: 'U1', status: 'success', steps: [] };

describe('MCP answers stay under 10000 characters', () => {
  it('for every read tool of the site module with default arguments', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'mcp-size-'));
    fake.env = { publicUrl: null, staging: true, deploy: null, templateDir: d, cacheDir: d, previewDir: d };
    const write = (kind: string, result: object) => writeFileSync(path.join(d, `${kind}-result.json`), JSON.stringify({ kind, ...base, result }));
    write('preview', { ...common, previewDir: '/x' });
    write('deployCheck', { log: common.log, target: 'user@host:/pfad', passed: true, checks: ['connect', 'targetDir', 'writable', 'targetFiles'].map((key) => ({ key, outcome: 'ok' })), filesAtTarget: files(2000) });
    write('publish', { status: 'success', diff: common.diff, log: common.log, skippedImages: [], record: { id: 'P01', contentHash: common.contentHash, log: common.log } });
    const deps = createTestDeps();
    insertUser(deps, { id: 'U1', name: 'Erika Beispiel' });
    for (let i = 1; i <= 20; i++) {
      deps.db
        .insert(sitePublishes)
        .values({ id: `P${String(i).padStart(2, '0')}`, environment: deps.env, startedAt: `2026-10-01T08:${String(i).padStart(2, '0')}:00.000Z`, status: 'success', triggeredByUserId: 'U1', summary: 'Publiziert: 3 Seiten geändert', log: 'l'.repeat(20_000), fileManifest: JSON.stringify(Object.fromEntries(files(2000).map((f) => [f, 'a'.repeat(64)]))) })
        .run();
    }
    const ctx = ctxWith(['site.publish', 'site.view'], 'U1');
    const tools = Object.fromEntries(moduleMcpTools(deps, siteModule).map((t) => [t.name, t]));
    const calls: [string, object][] = [['site_job_result', { kind: 'preview' }], ['site_job_result', { kind: 'deployCheck' }], ['site_job_result', { kind: 'publish' }], ['site_publishes', {}], ['site_publish_get', { id: 'P01' }]];
    const sizes: string[] = [];
    for (const [name, args] of calls) {
      const out = JSON.stringify(await tools[name]!.handler(deps, ctx, tools[name]!.inputSchema.parse(args)));
      sizes.push(`${name}${(args as { kind?: string }).kind ? `:${(args as { kind?: string }).kind}` : ''}=${out.length}`);
      expect(out.length, name).toBeLessThan(10_000);
    }
    console.log('MCP-Größen', sizes.join(' '));
  });
});
