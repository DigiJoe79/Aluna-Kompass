import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { diffTrees, hashTree, readSiteEnv, rsyncCommand, runPreview, runPublish, stripAnsi, websiteModule } from '../src';

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
      deploy: { host: 'h', user: 'u', path: '/web/staging', auth: { kind: 'key', keyFile: '/data/site.key' } },
      cacheDir: '/data/site-cache',
      previewDir: '/data/site-preview',
    });
  });

  it('reads a password file target and rejects a half configured one', () => {
    const base = { DATABASE_PATH: '/data/k.db', SITE_DEPLOY_HOST: 'h', SITE_DEPLOY_USER: 'u', SITE_DEPLOY_PATH: '/web' };
    expect(readSiteEnv({ ...base, SITE_DEPLOY_PASSWORD_FILE: '/data/site.pw' }).deploy).toEqual({
      host: 'h',
      user: 'u',
      path: '/web',
      auth: { kind: 'password', passwordFile: '/data/site.pw' },
    });
    expect(readSiteEnv({ ...base, SITE_DEPLOY_KEY_FILE: '/data/site.key' }).deploy).toEqual({
      host: 'h',
      user: 'u',
      path: '/web',
      auth: { kind: 'key', keyFile: '/data/site.key' },
    });
    // Ohne Anmeldeverfahren gibt es kein Ziel, sonst liefe der Publish ins Leere.
    expect(readSiteEnv({ ...base }).deploy).toBeNull();
  });

  it('resolves cache and preview directories to absolute paths', () => {
    const env = readSiteEnv({ DATABASE_PATH: './data/kompass.db' });
    expect(path.isAbsolute(env.cacheDir)).toBe(true);
    expect(path.isAbsolute(env.previewDir)).toBe(true);
    expect(env.cacheDir).toBe(path.resolve('data/site-cache'));
    expect(env.previewDir).toBe(path.resolve('data/site-preview'));
  });

  it('resolves an explicitly relative site, cache and preview directory', () => {
    const env = readSiteEnv({
      DATABASE_PATH: '/data/k.db',
      SITE_DIR: './apps/site',
      SITE_CACHE_DIR: './cache',
      SITE_PREVIEW_DIR: './preview',
    });
    expect(env.siteDir).toBe(path.resolve('apps/site'));
    expect(env.cacheDir).toBe(path.resolve('cache'));
    expect(env.previewDir).toBe(path.resolve('preview'));
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
      deploy: { host: '', user: '', path: target, auth: { kind: 'none' as const } },
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
      deploy: { host: '', user: '', path: tmp(), auth: { kind: 'none' as const } },
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

describe('rsyncCommand', () => {
  const local = { host: '', user: '', path: '/ziel', auth: { kind: 'none' } as const };
  const withKey = { host: 'h', user: 'u', path: '/web', auth: { kind: 'key', keyFile: '/data/site.key' } as const };
  const withPassword = { host: 'h', user: 'u', path: '/web', auth: { kind: 'password', passwordFile: '/data/site.pw' } as const };

  it('writes into a local directory without ssh', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: local });
    expect(c.command).toBe('rsync');
    expect(c.args).toEqual(['-az', '--delete', '--checksum', '/build/', '/ziel/']);
  });

  it('uses the key file and refuses to prompt', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: withKey });
    expect(c.command).toBe('rsync');
    expect(c.args.join(' ')).toContain('ssh -i /data/site.key');
    expect(c.args.join(' ')).toContain('BatchMode=yes');
    expect(c.args).toContain('u@h:/web/');
  });

  it('wraps rsync in sshpass for password logins and never puts the secret on the command line', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: withPassword });
    expect(c.command).toBe('sshpass');
    expect(c.args.slice(0, 3)).toEqual(['-f', '/data/site.pw', 'rsync']);
    // BatchMode würde die Passwortabfrage abschalten und den Login unmöglich machen.
    expect(c.args.join(' ')).not.toContain('BatchMode');
    expect(c.args).toContain('u@h:/web/');
  });

  it('passes the dry run flag through for a harmless connection test', () => {
    expect(rsyncCommand({ distDir: '/build', deploy: withPassword, dryRun: true }).args).toContain('--dry-run');
    expect(rsyncCommand({ distDir: '/build', deploy: local }).args).not.toContain('--dry-run');
  });
});

describe('stripAnsi', () => {
  it('removes the escape sequences vite emits, so the log stays readable', () => {
    const raw = '\u001B[2m16:46:43\u001B[22m \u001B[34m[build]\u001B[39m Fertig';
    expect(stripAnsi(raw)).toBe('16:46:43 [build] Fertig');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripAnsi('Tsconfig not found /app/tsconfig.base.json')).toBe('Tsconfig not found /app/tsconfig.base.json');
  });
});
