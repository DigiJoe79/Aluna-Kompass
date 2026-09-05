import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { diffTrees, hashTree, readSiteEnv, runPreview, runPublish, websiteModule } from '../src';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-pipe-'));
  dirs.push(d);
  return d;
};
const SITE_DIR = path.resolve(import.meta.dirname, '../../../../apps/site');

describe('diff', () => {
  it('hashes trees and reports changed, added and removed files', async () => {
    const a = tmp();
    mkdirSync(path.join(a, 'sub'));
    writeFileSync(path.join(a, 'index.html'), 'a');
    writeFileSync(path.join(a, 'sub', 'x.html'), 'x');
    const before = await hashTree(a);
    writeFileSync(path.join(a, 'index.html'), 'b');
    writeFileSync(path.join(a, 'new.html'), 'n');
    rmSync(path.join(a, 'sub', 'x.html'));
    const after = await hashTree(a);
    expect(diffTrees(before, after)).toEqual({ changed: ['index.html'], added: ['new.html'], removed: ['sub/x.html'] });
  });
});

describe('readSiteEnv', () => {
  it('reports no deploy target when variables are missing and parses them when present', () => {
    expect(readSiteEnv({ DATABASE_PATH: '/data/k.db' }).deploy).toBeNull();
    const env = readSiteEnv({
      DATABASE_PATH: '/data/k.db',
      SITE_PUBLIC_URL: 'https://staging.example.org',
      SITE_STAGING: '1',
      SITE_DEPLOY_HOST: 'h',
      SITE_DEPLOY_USER: 'u',
      SITE_DEPLOY_PATH: '/web/staging',
      SITE_DEPLOY_KEY_FILE: '/data/site.key',
    });
    expect(env).toMatchObject({
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: 'h', user: 'u', path: '/web/staging', keyFile: '/data/site.key' },
      cacheDir: '/data/site-cache',
      previewDir: '/data/site-preview',
    });
  });
});

describe('preview and publish', () => {
  it('builds a preview from live content, computes the diff against nothing, and publishes to a local rsync target', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['website.publish', 'website.view', 'website.manage']);
    const target = tmp();
    const env = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: '', user: '', path: target, keyFile: '' },
      siteDir: SITE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
    };
    const preview = unwrap(await runPreview(deps, ctx, env));
    expect(preview.violations).toEqual([]);
    expect(preview.diff.added.length).toBeGreaterThan(10);
    expect(readFileSync(path.join(preview.previewDir, 'index.html'), 'utf8')).toContain('noindex');

    const published = unwrap(await runPublish(deps, ctx, env, { confirm: true }));
    expect(published.status).toBe('success');
    expect(readFileSync(path.join(target, 'index.html'), 'utf8')).toContain('<html');
    const again = unwrap(await runPreview(deps, ctx, env));
    expect(again.diff).toEqual({ changed: [], added: [], removed: [] });
  }, 240_000);

  it('refuses to publish without confirmation, without a target, in development, or with blocked terms', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['website.publish', 'website.view']);
    const base = {
      publicUrl: 'https://x',
      staging: true,
      deploy: { host: '', user: '', path: tmp(), keyFile: '' },
      siteDir: SITE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
    };
    const noConfirm = await runPublish(deps, ctx, base, { confirm: false });
    expect(noConfirm.ok === false && noConfirm.error.type === 'validation').toBe(true);
    const noTarget = await runPublish(deps, ctx, { ...base, deploy: null }, { confirm: true });
    expect(noTarget.ok === false && noTarget.error.type === 'conflict' && noTarget.error.code === 'publishTargetMissing').toBe(true);
    const dev = createTestDeps({ manifests: [coreModule, websiteModule], env: 'development' });
    insertUser(dev, { id: 'USER-TEST' });
    const inDev = await runPublish(dev, ctx, base, { confirm: true });
    expect(inDev.ok === false && inDev.error.type === 'conflict' && inDev.error.code === 'publishNotAllowedHere').toBe(true);
  });
});
