import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, setModuleEnabled, unwrap } from '@kompass/core';
import { projectsModule } from '@kompass/module-projects';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSiteCache, runningSiteJob, siteCacheStatus, siteModule, startPreview } from '../src';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-cache-'));
  dirs.push(d);
  return d;
};

const deps = () => {
  const d = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: ['de', 'en'] });
  insertUser(d, { id: 'USER-TEST' });
  return d;
};
const TEMPLATE_DIR = path.resolve(import.meta.dirname, '../../../../templates/verein-basis');

const setup = () => {
  const env = { publicUrl: 'https://x', staging: true, deploy: null, templateDir: TEMPLATE_DIR, cacheDir: tmp(), previewDir: tmp() };
  const old = new Date('2026-09-01T00:00:00.000Z');
  const recent = new Date('2026-09-20T00:00:00.000Z');
  writeFileSync(path.join(env.cacheDir, 'v1-aaa-480.webp'), 'abc');
  writeFileSync(path.join(env.cacheDir, 'v1-bbb-960.webp'), 'abcde');
  utimesSync(path.join(env.cacheDir, 'v1-aaa-480.webp'), old, old);
  utimesSync(path.join(env.cacheDir, 'v1-bbb-960.webp'), recent, recent);
  writeFileSync(path.join(env.cacheDir, 'preview-build.json'), '{}');
  writeFileSync(path.join(env.cacheDir, 'preview-result.json'), '{}');
  writeFileSync(path.join(env.previewDir, 'index.html'), '0123456789');
  return env;
};

describe('siteCacheStatus', () => {
  it('reports images and preview', () => {
    const env = setup();
    expect(unwrap(siteCacheStatus(deps(), ctxWith(['site.manage']), env))).toEqual({
      images: { count: 2, bytes: 8, oldest: '2026-09-01T00:00:00.000Z', newest: '2026-09-20T00:00:00.000Z' },
      preview: { bytes: 10, builtAt: statSync(path.join(env.cacheDir, 'preview-build.json')).mtime.toISOString() },
    });
  });
  it('reports an empty cache', () => {
    const env = { publicUrl: 'https://x', staging: true, deploy: null, templateDir: TEMPLATE_DIR, cacheDir: path.join(tmp(), 'gibt-es-nicht'), previewDir: tmp() };
    expect(unwrap(siteCacheStatus(deps(), ctxWith(['site.manage']), env))).toEqual({ images: { count: 0, bytes: 0, oldest: null, newest: null }, preview: { bytes: 0, builtAt: null } });
  });
  it('needs site.manage', () => {
    expect(siteCacheStatus(deps(), ctxWith(['site.publish']), setup())).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('clearSiteCache', () => {
  it('clears variants, preview and stamp, keeps results, and audits', () => {
    const d = deps();
    const env = setup();
    mkdirSync(path.join(env.previewDir, 'sub'));
    writeFileSync(path.join(env.previewDir, 'sub', 'a.html'), 'x');
    // 2 Varianten + Stempel + 2 Vorschau-Dateien
    expect(unwrap(clearSiteCache(d, ctxWith(['site.manage']), env))).toEqual({ removed: 5 });
    expect(readdirSync(env.cacheDir)).toEqual(['preview-result.json']);
    expect(readdirSync(env.previewDir)).toEqual([]);
    expect(auditEntry(d, 'site.cacheClear')).toMatchObject({ action: 'site.cacheClear', entityType: 'siteCache', after: JSON.stringify({ removed: 5 }) });
  });
  it('needs site.manage and deletes nothing without it', () => {
    const env = setup();
    expect(clearSiteCache(deps(), ctxWith(['site.publish']), env)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(readdirSync(env.cacheDir)).toContain('v1-aaa-480.webp');
  });
  it('refuses while a job runs and deletes nothing', async () => {
    const d = deps();
    const env = setup();
    unwrap(await startPreview(d, ctxWith(['site.publish']), env, { source: 'ui' }));
    expect(clearSiteCache(d, ctxWith(['site.manage']), env)).toMatchObject({ ok: false, error: { type: 'conflict', code: 'siteJobRunning' } });
    expect(readdirSync(env.cacheDir)).toContain('v1-aaa-480.webp');
    await vi.waitFor(() => expect(runningSiteJob(env)).toBeNull(), { timeout: 20_000 });
  }, 30_000);
});
