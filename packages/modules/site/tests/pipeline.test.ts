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
  REUSED_PREVIEW,
  runPreview,
  runPublish,
  setEntryPublished,
  setValues,
  listPublishes,
  currentSiteJob,
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
      DATA_PATH: '/data',
      CACHE_PATH: '/cache',
      SITE_PUBLIC_URL: 'https://staging.example.org',
      SITE_STAGING: '1',
      SITE_DEPLOY_HOST: 'h',
      SITE_DEPLOY_USER: 'u',
      SITE_DEPLOY_PATH: '/web/staging',
      SITE_DEPLOY_KEY_FILE: '/secret/site.key',
      SITE_TEMPLATE_DIR: '/data/site/template',
    });
    expect(env).toMatchObject({
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: 'h', user: 'u', path: '/web/staging', auth: { kind: 'key', keyFile: '/secret/site.key' } },
      templateDir: path.resolve('/data/site/template'),
      cacheDir: path.resolve('/cache/site-build'),
      previewDir: path.resolve('/cache/site-preview'),
    });
  });

  it('reads a password file target and rejects a half configured one', () => {
    const base = { DATA_PATH: '/data', SITE_DEPLOY_HOST: 'h', SITE_DEPLOY_USER: 'u', SITE_DEPLOY_PATH: '/web' };
    expect(readSiteEnv({ ...base, SITE_DEPLOY_PASSWORD_FILE: '/secret/site.pw' }).deploy).toEqual({
      host: 'h',
      user: 'u',
      path: '/web',
      auth: { kind: 'password', passwordFile: '/secret/site.pw' },
    });
    expect(readSiteEnv({ ...base, SITE_DEPLOY_KEY_FILE: '/secret/site.key' }).deploy).toEqual({
      host: 'h',
      user: 'u',
      path: '/web',
      auth: { kind: 'key', keyFile: '/secret/site.key' },
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

  /**
   * Vorschau ansehen, dann publizieren ist der normale Ablauf — und er baute
   * die Seite zweimal. Auf dem Läufer kostete allein dieser Test drei Minuten,
   * auf dem NAS wartet dabei ein Mensch.
   */
  it('publishes the preview it just built instead of building a second time', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const manageCtx = ctxWith(['site.manage', 'site.view', 'media.upload']);
    const publishCtx = ctxWith(['site.publish', 'site.view']);
    unwrap(await applyTemplateSync(deps, manageCtx, { dir: TEMPLATE_DIR, confirm: true }));
    unwrap(await setValues(deps, manageCtx, { values: { claim: { de: 'Erster Stand' } } }));

    const target = tmp();
    const env = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: '', user: '', path: target, auth: { kind: 'none' as const } },
      templateDir: TEMPLATE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
    };

    unwrap(await runPreview(deps, publishCtx, env));
    const published = unwrap(await runPublish(deps, publishCtx, env, { confirm: true }));
    expect(published.record.log).toContain(REUSED_PREVIEW);
    expect(readFileSync(path.join(target, 'index.html'), 'utf8')).toContain('Erster Stand');

    // Nach einer Änderung ist die Vorschau nicht mehr der Stand, der publiziert
    // werden soll — dann muss neu gebaut werden.
    unwrap(await setValues(deps, manageCtx, { values: { claim: { de: 'Zweiter Stand' } } }));
    const again = unwrap(await runPublish(deps, publishCtx, env, { confirm: true }));
    expect(again.record.log).not.toContain(REUSED_PREVIEW);
    expect(readFileSync(path.join(target, 'index.html'), 'utf8')).toContain('Zweiter Stand');
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
    expect(c.args).toEqual(['-az', '--no-owner', '--no-group', '--no-perms', '--omit-dir-times', '--delete', '--checksum', '--delay-updates', '/build/', '/ziel/']);
  });

  it('uses the key file and refuses to prompt', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: withKey });
    expect(c.command).toBe('rsync');
    expect(c.args).toEqual([
      '-az',
      '--no-owner',
      '--no-group',
      '--no-perms',
      '--omit-dir-times',
      '--delete',
      '--checksum',
      '--delay-updates',
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
      '--no-perms',
      '--omit-dir-times',
      '--delete',
      '--checksum',
      '--delay-updates',
      '-e',
      'ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o NumberOfPasswordPrompts=1 -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no',
      '/build/',
      'u@h:/web/',
    ]);
  });

  it('adds dry-run and itemize-changes flags when requested', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: local, dryRun: true });
    expect(c.args).toEqual(['-az', '--no-owner', '--no-group', '--no-perms', '--omit-dir-times', '--delete', '--checksum', '--delay-updates', '--dry-run', '--itemize-changes', '/build/', '/ziel/']);
  });
});

describe('one job at a time', () => {
  const setup = async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: TEMPLATE_DIR, confirm: true }));
    const env = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: '', user: '', path: tmp(), auth: { kind: 'none' as const } },
      templateDir: TEMPLATE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
    };
    return { deps, env, publishCtx: ctxWith(['site.publish', 'site.view']) };
  };

  /**
   * Zwei Personen auf „Vorschau bauen“ räumten dasselbe Verzeichnis
   * gleichzeitig ab. Der zweite Lauf wartet nicht, er meldet den ersten.
   */
  it('refuses a second preview while the first is still building', async () => {
    const { deps, env, publishCtx } = await setup();
    const [first, second] = await Promise.all([runPreview(deps, publishCtx, env), runPreview(deps, publishCtx, env)]);
    const outcomes = [first, second].map((r) => (r.ok ? 'ok' : r.error.type === 'conflict' ? r.error.code : r.error.type)).sort();
    expect(outcomes).toEqual(['ok', 'siteJobRunning']);
    // Danach ist der Riegel wieder offen.
    expect((await runPreview(deps, publishCtx, env)).ok).toBe(true);
  }, 240_000);

  it('releases the guard when a run fails', async () => {
    const { deps, env, publishCtx } = await setup();
    const failed = await runPreview(deps, publishCtx, { ...env, publicUrl: null });
    expect(failed.ok).toBe(false);
    expect((await runPreview(deps, publishCtx, env)).ok).toBe(true);
  }, 240_000);
});

describe('publish history', () => {
  /**
   * Ein Publish, der vor dem Build scheitert — Template veraltet, Modul
   * abgeschaltet —, hinterliess keine Zeile. Wer nachsah, warum gestern
   * nichts publiziert wurde, fand nichts.
   */
  it('records an aborted attempt when the export refuses', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: TEMPLATE_DIR, confirm: true }));
    // Ein Template-Verzeichnis, dessen Deklaration vom eingelesenen Stand abweicht.
    const stale = tmp();
    writeFileSync(path.join(stale, 'kompass.template.ts'), `${readFileSync(path.join(TEMPLATE_DIR, 'kompass.template.ts'), 'utf8')}\n// geändert\n`);
    symlinkSync(path.join(TEMPLATE_DIR, 'node_modules'), path.join(stale, 'node_modules'));
    const env = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: '', user: '', path: tmp(), auth: { kind: 'none' as const } },
      templateDir: stale,
      cacheDir: tmp(),
      previewDir: tmp(),
    };
    const publishCtx = ctxWith(['site.publish', 'site.view']);
    const result = await runPublish(deps, publishCtx, env, { confirm: true });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'templateStale').toBe(true);
    const history = unwrap(await listPublishes(deps, publishCtx, { environment: 'test' }));
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('aborted');
    expect(history[0]!.log).toContain('templateStale');
  });
});

describe('currentSiteJob', () => {
  /**
   * Wer den Tab schliesst, sieht nicht, dass noch gebaut wird. Die Seite fragt
   * deshalb nach, was gerade laeuft und seit wann — auch nach dem Neuladen.
   */
  it('names the running job with its start, and is empty afterwards', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: TEMPLATE_DIR, confirm: true }));
    const env = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: null,
      templateDir: TEMPLATE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
    };
    expect(currentSiteJob(env)).toBeNull();
    const running = runPreview(deps, ctxWith(['site.publish', 'site.view']), env);
    expect(currentSiteJob(env)).toEqual({ name: 'preview', startedAt: deps.clock.now().toISOString() });
    unwrap(await running);
    expect(currentSiteJob(env)).toBeNull();
  }, 240_000);
});
