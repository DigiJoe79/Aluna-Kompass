import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTemplateSync,
  checkDeployCredentials,
  checkDeployTarget,
  createEntry,
  diffTrees,
  hashTree,
  readSiteEnv,
  rsyncCommand,
  runPreview,
  runPublish,
  setEntryPublished,
  setValues,
  siteModule,
} from '../src';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-pipe-'));
  dirs.push(d);
  return d;
};

const TEMPLATE_DIR = path.resolve(import.meta.dirname, '../../../../templates/verein-basis');
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

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

  it('does not follow symlinks, so a loop cannot spin the process forever', async () => {
    const a = tmp();
    mkdirSync(path.join(a, 'sub'));
    writeFileSync(path.join(a, 'index.html'), 'a');
    symlinkSync(a, path.join(a, 'sub', 'zurueck'));
    const tree = await hashTree(a);
    expect(Object.keys(tree).sort()).toEqual(['index.html', 'sub/zurueck']);
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
      SITE_TEMPLATE_DIR: '/data/site-template',
    });
    expect(env).toMatchObject({
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: 'h', user: 'u', path: '/web/staging', auth: { kind: 'key', keyFile: '/data/site.key' } },
      templateDir: path.resolve('/data/site-template'),
      cacheDir: path.resolve('/data/site-cache'),
      previewDir: path.resolve('/data/site-preview'),
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
    expect(readSiteEnv({ ...base }).deploy).toBeNull();
  });
});

describe('preview and publish against templates/verein-basis', () => {
  it('builds a preview from live content, publishes to a local target including images, and checks diff', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const manageCtx = ctxWith(['site.manage', 'site.view', 'media.upload']);
    const publishCtx = ctxWith(['site.publish', 'site.view']);

    // 1. Template einlesen
    unwrap(await applyTemplateSync(deps, manageCtx, { dir: TEMPLATE_DIR, confirm: true }));

    // 2. Ein Bild hochladen
    const heroAsset = unwrap(await storeMediaAsset(deps, manageCtx, { originalName: 'hero.png', bytes: PNG }));

    // 3. Variablen setzen
    unwrap(await setValues(deps, manageCtx, {
      values: {
        claim: { de: 'Willkommen bei Verein Basis' },
        heroImage: heroAsset.id,
      },
    }));

    // 4. Einen Sammlungseintrag anlegen (news mit Bild)
    const newsEntry = unwrap(await createEntry(deps, manageCtx, {
      collection: 'news',
      slug: 'erster-beitrag',
      data: {
        title: { de: 'Unser erster Beitrag' },
        body: { de: 'Neuigkeiten aus dem Verein.' },
        image: heroAsset.id,
      },
    }));
    unwrap(await setEntryPublished(deps, manageCtx, { id: newsEntry.id, isPublished: true }));

    const target = tmp();
    const env = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: '', user: '', path: target, auth: { kind: 'none' as const } },
      templateDir: TEMPLATE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
    };

    // 5. runPreview ausführen
    const preview = unwrap(await runPreview(deps, publishCtx, env));
    expect(preview.violations).toEqual([]);
    expect(preview.diff.added.length).toBeGreaterThan(0);
    expect(readFileSync(path.join(preview.previewDir, 'index.html'), 'utf8')).toContain('Verein Basis');

    // 6. runPublish ausführen
    const published = unwrap(await runPublish(deps, publishCtx, env, { confirm: true }));
    expect(published.status).toBe('success');
    expect(readFileSync(path.join(target, 'index.html'), 'utf8')).toContain('Verein Basis');

    // 7. Prüfen, dass Bilder übertragen wurden
    const imagesDir = path.join(target, 'images');
    const images = readdirSync(imagesDir);
    expect(images.length).toBeGreaterThan(0);
    expect(images.some((f) => f.endsWith('.webp'))).toBe(true);

    // 8. Zweiter Preview-Lauf: kein Diff gegenüber dem publizierten Stand
    const again = unwrap(await runPreview(deps, publishCtx, env));
    expect(again.diff).toEqual({ changed: [], added: [], removed: [] });
  }, 240_000);

  it('refuses to publish without confirmation, without a target, in development, or with blocked terms', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const manageCtx = ctxWith(['site.manage', 'settings.manage']);
    const publishCtx = ctxWith(['site.publish', 'site.view']);

    unwrap(await applyTemplateSync(deps, manageCtx, { dir: TEMPLATE_DIR, confirm: true }));

    const base = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: '', user: '', path: tmp(), auth: { kind: 'none' as const } },
      templateDir: TEMPLATE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
    };

    const noConfirm = await runPublish(deps, publishCtx, base, { confirm: false });
    expect(noConfirm.ok === false && noConfirm.error.type === 'validation').toBe(true);

    const noTarget = await runPublish(deps, publishCtx, { ...base, deploy: null }, { confirm: true });
    expect(noTarget.ok === false && noTarget.error.type === 'conflict' && noTarget.error.code === 'publishTargetMissing').toBe(true);

    const dev = createTestDeps({ manifests: [coreModule, siteModule], env: 'development' });
    insertUser(dev, { id: 'USER-TEST' });
    unwrap(await applyTemplateSync(dev, manageCtx, { dir: TEMPLATE_DIR, confirm: true }));
    const inDev = await runPublish(dev, publishCtx, base, { confirm: true });
    expect(inDev.ok === false && inDev.error.type === 'conflict' && inDev.error.code === 'publishNotAllowedHere').toBe(true);

    // Mit Sperrwort abbrechen
    unwrap(await setSetting(deps, manageCtx, { key: 'site.blockedTerms', value: ['strenggeheim'] }));
    unwrap(await setValues(deps, manageCtx, { values: { claim: { de: 'strenggeheim' } } }));
    const blocked = await runPublish(deps, publishCtx, base, { confirm: true });
    expect(blocked.ok === false && blocked.error.type === 'conflict' && blocked.error.code === 'blockedTermsPresent').toBe(true);
  }, 240_000);
});

describe('checkDeployTarget', () => {
  const envFor = (target: string | null) => ({
    publicUrl: 'https://x',
    staging: true,
    deploy: target === null ? null : { host: '', user: '', path: target, auth: { kind: 'none' as const } },
    templateDir: TEMPLATE_DIR,
    cacheDir: tmp(),
    previewDir: tmp(),
  });

  it('needs the publish permission and a configured target', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const denied = await checkDeployTarget(deps, ctxWith(['site.view']), envFor(tmp()));
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
    const noTarget = await checkDeployTarget(deps, ctxWith(['site.publish']), envFor(null));
    expect(noTarget.ok === false && noTarget.error.type === 'conflict' && noTarget.error.code === 'publishTargetMissing').toBe(true);
  });

  it('reports what a publish would remove at the target and leaves every file in place', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const target = tmp();
    writeFileSync(path.join(target, 'wp-config.php'), '<?php');
    mkdirSync(path.join(target, 'wp-content'));
    writeFileSync(path.join(target, 'wp-content', 'logo.png'), 'binary');

    const result = unwrap(await checkDeployTarget(deps, ctxWith(['site.publish']), envFor(target)));

    expect(result.target).toBe(target);
    expect(result.filesAtTarget).toEqual(expect.arrayContaining(['wp-config.php', 'wp-content/logo.png']));
    expect(result.log).toContain('--dry-run');
    expect(readFileSync(path.join(target, 'wp-config.php'), 'utf8')).toBe('<?php');
    expect(readFileSync(path.join(target, 'wp-content', 'logo.png'), 'utf8')).toBe('binary');
  });

  it('comes back empty when the path points nowhere', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const missing = path.join(tmp(), 'vertippt');
    const result = unwrap(await checkDeployTarget(deps, ctxWith(['site.publish']), envFor(missing)));
    expect(result.filesAtTarget).toEqual([]);
  });

  it('reports unusable credentials instead of starting rsync', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const env = { ...envFor(tmp()), deploy: { host: 'webhost', user: 'web', path: '/www', auth: { kind: 'key' as const, keyFile: '/gibt/es/nicht.key' } } };
    const result = await checkDeployTarget(deps, ctxWith(['site.publish']), env);
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'deployCredentialsUnusable').toBe(true);
  });
});

describe('rsyncCommand', () => {
  const local = { host: '', user: '', path: '/ziel', auth: { kind: 'none' } as const };
  const withKey = { host: 'h', user: 'u', path: '/web', auth: { kind: 'key', keyFile: '/data/site.key' } as const };
  const withPassword = { host: 'h', user: 'u', path: '/web', auth: { kind: 'password', passwordFile: '/data/site.pw' } as const };

  it('writes into a local directory without ssh', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: local });
    expect(c.command).toBe('rsync');
    expect(c.args).toEqual(['-az', '--no-owner', '--no-group', '--delete', '--checksum', '/build/', '/ziel/']);
  });

  it('uses the key file and refuses to prompt', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: withKey });
    expect(c.command).toBe('rsync');
    expect(c.args).toEqual([
      '-az',
      '--no-owner',
      '--no-group',
      '--delete',
      '--checksum',
      '-e',
      'ssh -i /data/site.key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o NumberOfPasswordPrompts=1 -o BatchMode=yes',
      '/build/',
      'u@h:/web/',
    ]);
  });

  it('passes the password file through sshpass', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: withPassword });
    expect(c.command).toBe('sshpass');
    expect(c.args).toEqual([
      '-f',
      '/data/site.pw',
      'rsync',
      '-az',
      '--no-owner',
      '--no-group',
      '--delete',
      '--checksum',
      '-e',
      'ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o NumberOfPasswordPrompts=1 -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no',
      '/build/',
      'u@h:/web/',
    ]);
  });

  it('adds dry-run and itemize-changes flags when requested', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: local, dryRun: true });
    expect(c.args).toEqual(['-az', '--no-owner', '--no-group', '--delete', '--checksum', '--dry-run', '--itemize-changes', '/build/', '/ziel/']);
  });
});
