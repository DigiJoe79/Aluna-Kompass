import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, fixedClock, setModuleEnabled, setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { projectsModule } from '@kompass/module-projects';
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
  removeLegacyStages,
  rsyncCommand,
  REUSED_PREVIEW,
  runPreview,
  runPublish,
  setEntryPublished,
  setValues,
  listPublishes,
  getPublish,
  runningSiteJob,
  lastSiteJob,
  siteJobElapsedMs,
  startDeployCheck,
  startPreview,
  startPublish,
  siteModule,
  type SiteJobKind,
  type SiteJobStep,
  type StepKey,
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

const lastRecord = (env: { cacheDir: string }, kind: SiteJobKind) =>
  JSON.parse(readFileSync(path.join(env.cacheDir, `${kind}-result.json`), 'utf8')) as { steps: SiteJobStep[] };

const TEMPLATE_DIR = path.resolve(import.meta.dirname, '../../../../templates/verein-basis');
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

/**
 * `verein-basis` fordert seit dem 2026-09-15 zwei Sprachen — das mitgelieferte
 * Beispiel zeigt, wie ein zweisprachiges Template aussieht. Eine Installation,
 * die nur Deutsch führt, weist das Template mit `localeMissing` ab; die
 * Testinstallation richtet deshalb beide ein.
 */
const LOCALES = ['de', 'en'];

/** `kompass.template.ts` von verein-basis nennt seit dem Projekt-Teaser `uses: ['projects']`. */
const enableProjects = (deps: ReturnType<typeof createTestDeps>) => setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'projects', enabled: true });

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
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await enableProjects(deps));
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

    // Altlast aus Fassungen bis 0.2.4: Bauverzeichnis unter dem Template.
    const legacy = path.join(TEMPLATE_DIR, '.astro', `out-legacy-${Date.now()}`);
    mkdirSync(path.join(legacy, 'x'), { recursive: true });

    // 5. runPreview ausführen
    const preview = unwrap(await runPreview(deps, publishCtx, env));
    // Jeder Schritt kennt seinen Stand und zählt mit.
    const previewRun = lastRecord(env, 'preview');
    expect(previewRun.steps.map((st) => [st.key, st.state])).toEqual([['export', 'done'], ['images', 'done'], ['build', 'done'], ['copyImages', 'done'], ['checksums', 'done']]);
    const by = (rec: ReturnType<typeof lastRecord>, k: StepKey) => rec.steps.find((st) => st.key === k)!;
    expect(by(previewRun, 'export')).toMatchObject({ done: 1, total: 1 });
    expect(by(previewRun, 'images').detail?.generated).toBeGreaterThan(0);
    expect(by(previewRun, 'build').done).toBeGreaterThan(0);
    expect(by(previewRun, 'build').total).toBeUndefined();
    expect(by(previewRun, 'checksums').done).toBe(by(previewRun, 'checksums').total);
    // Gebaut wird im Cache; der erste Bau räumt die Altlast unter dem Template weg.
    expect(existsSync(legacy)).toBe(false);
    expect(readdirSync(env.cacheDir).filter((n) => n.startsWith('out-'))).toEqual([]);
    expect(preview.violations).toEqual([]);
    expect(preview.diff.added.length).toBeGreaterThan(0);
    expect(readFileSync(path.join(preview.previewDir, 'index.html'), 'utf8')).toContain('Verein Basis');

    // 6. runPublish ausführen
    const published = unwrap(await runPublish(deps, publishCtx, env, { confirm: true }));
    expect(published.status).toBe('success');
    const publishRun = lastRecord(env, 'publish');
    // Die Vorschau wird übernommen: sofort „übersprungen“, das Kopieren zählt mit.
    expect(by(publishRun, 'build')).toMatchObject({ state: 'skipped' });
    expect(by(publishRun, 'build').total).toBeGreaterThan(0);
    expect(by(publishRun, 'build').done).toBe(by(publishRun, 'build').total);
    const sent = published.diff.added.length + published.diff.changed.length;
    expect(by(publishRun, 'transfer')).toMatchObject({ state: 'done', done: sent, total: sent });
    expect(publishRun.steps.at(-1)).toMatchObject({ key: 'record', state: 'done' });
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
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await enableProjects(deps));
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

  /**
   * Eine abgebrochene Vorschau lässt ein halbes Verzeichnis zurück; der Stempel
   * der vorigen darf dann nicht mehr behaupten, es sei fertig. Dasselbe gilt
   * für einen Stempel aus einer anderen Cache-Version.
   */
  describe('preview stamp', () => {
    const prepared = async () => {
      const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
      insertUser(deps, { id: 'USER-TEST' });
      unwrap(await enableProjects(deps));
      const manageCtx = ctxWith(['site.manage', 'site.view', 'media.upload']);
      unwrap(await applyTemplateSync(deps, manageCtx, { dir: TEMPLATE_DIR, confirm: true }));
      unwrap(await setValues(deps, manageCtx, { values: { claim: { de: 'Erster Stand' } } }));
      const env = {
        publicUrl: 'https://staging.example.org',
        staging: true,
        deploy: { host: '', user: '', path: tmp(), auth: { kind: 'none' as const } },
        templateDir: TEMPLATE_DIR,
        cacheDir: tmp(),
        previewDir: tmp(),
        workDir: tmp(),
      };
      return { deps, env, publishCtx: ctxWith(['site.publish', 'site.view']) };
    };

    it('never publishes the half of a preview that was aborted', async () => {
      const { deps, env, publishCtx } = await prepared();
      unwrap(await runPreview(deps, publishCtx, env));
      const stamp = path.join(env.cacheDir, 'preview-build.json');
      expect(existsSync(stamp)).toBe(true);
      const aborted = await runPreview(deps, publishCtx, { ...env, limits: { build: { totalMs: 1 } } });
      expect(aborted).toMatchObject({ ok: false, error: { code: 'stepTimedOut' } });
      expect(existsSync(stamp)).toBe(false);
      const published = unwrap(await runPublish(deps, publishCtx, env, { confirm: true }));
      expect(published.record.log).not.toContain(REUSED_PREVIEW);
    }, 240_000);

    it('drops a stamp of another cache version', async () => {
      const { deps, env, publishCtx } = await prepared();
      unwrap(await runPreview(deps, publishCtx, env));
      const stamp = path.join(env.cacheDir, 'preview-build.json');
      writeFileSync(stamp, JSON.stringify({ ...JSON.parse(readFileSync(stamp, 'utf8')), cacheVersion: 'v0' }));
      const published = unwrap(await runPublish(deps, publishCtx, env, { confirm: true }));
      expect(published.record.log).not.toContain(REUSED_PREVIEW);
      expect(existsSync(stamp)).toBe(false);
    }, 240_000);
  });

  it('refuses to publish without confirmation, without a target, in development, or with blocked terms', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await enableProjects(deps));
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

    const dev = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES, env: 'development' });
    insertUser(dev, { id: 'USER-TEST' });
    unwrap(await enableProjects(dev));
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

describe('removeLegacyStages', () => {
  it('removes only out-* below .astro and survives a missing directory', async () => {
    const site = tmp();
    mkdirSync(path.join(site, '.astro', 'out-abc'), { recursive: true });
    writeFileSync(path.join(site, '.astro', 'data-store.json'), '{}');
    expect(await removeLegacyStages(site)).toBe(1);
    expect(readdirSync(path.join(site, '.astro'))).toEqual(['data-store.json']);
    expect(await removeLegacyStages(tmp())).toBe(0);
  });
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
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    const denied = await checkDeployTarget(deps, ctxWith(['site.view']), envFor(tmp()));
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
    const noTarget = await checkDeployTarget(deps, ctxWith(['site.publish']), envFor(null));
    expect(noTarget.ok === false && noTarget.error.type === 'conflict' && noTarget.error.code === 'publishTargetMissing').toBe(true);
  });

  it('reports unusable credentials instead of starting rsync', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    const env = { ...envFor(tmp()), deploy: { host: 'webhost', user: 'web', path: '/www', auth: { kind: 'key' as const, keyFile: '/gibt/es/nicht.key' } } };
    const result = await checkDeployTarget(deps, ctxWith(['site.publish']), env);
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'deployCredentialsUnusable').toBe(true);
  });
});

describe('publish content check', () => {
  const setup = async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await enableProjects(deps));
    const manageCtx = ctxWith(['site.manage', 'site.view', 'media.upload']);
    const publishCtx = ctxWith(['site.publish', 'site.view']);
    unwrap(await applyTemplateSync(deps, manageCtx, { dir: TEMPLATE_DIR, confirm: true }));
    const target = tmp();
    const env = { publicUrl: 'https://staging.example.org', staging: true, deploy: { host: '', user: '', path: target, auth: { kind: 'none' as const } }, templateDir: TEMPLATE_DIR, cacheDir: tmp(), previewDir: tmp() };
    return { deps, manageCtx, publishCtx, env, target };
  };

  it('refuses a publish whose preview no longer matches, before building, and records the attempt', async () => {
    const { deps, publishCtx, env, target } = await setup();
    const result = await runPublish(deps, publishCtx, env, { confirm: true, expectedContentHash: 'f'.repeat(64) });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code).toBe('previewOutdated');
    expect(result.ok === false && result.error.type === 'conflict' && result.error.messageKey).toBe('errors.site.previewOutdated');
    expect(readdirSync(target)).toEqual([]);
    const [row] = unwrap(await listPublishes(deps, publishCtx, { environment: 'test' }));
    expect(row).toMatchObject({ status: 'aborted' });
    expect(row!.summary).toContain('previewOutdated');
    const rec = lastRecord(env, 'publish');
    expect(rec.steps.find((st) => st.key === 'build')!.state).toBe('pending');
  });

  it('publishes when the hash is the one the preview showed', async () => {
    const { deps, publishCtx, env } = await setup();
    const preview = unwrap(await runPreview(deps, publishCtx, env));
    const published = unwrap(await runPublish(deps, publishCtx, env, { confirm: true, expectedContentHash: preview.contentHash }));
    expect(published.status).toBe('success');
  }, 240_000);
});

describe('rsyncCommand', () => {
  const local = { host: '', user: '', path: '/ziel', auth: { kind: 'none' } as const };
  const withKey = { host: 'h', user: 'u', path: '/web', auth: { kind: 'key', keyFile: '/data/site.key' } as const };
  const withPassword = { host: 'h', user: 'u', path: '/web', auth: { kind: 'password', passwordFile: '/data/site.pw' } as const };

  it('writes into a local directory without ssh', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: local });
    expect(c.command).toBe('rsync');
    expect(c.args).toEqual(['-az', '--no-owner', '--no-group', '--no-perms', '--omit-dir-times', '--delete-delay', '--checksum', '--delay-updates', '--out-format=%n', '/build/', '/ziel/']);
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
      '--delete-delay',
      '--checksum',
      '--delay-updates',
      '--out-format=%n',
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
      '--delete-delay',
      '--checksum',
      '--delay-updates',
      '--out-format=%n',
      '-e',
      'ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o NumberOfPasswordPrompts=1 -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no',
      '/build/',
      'u@h:/web/',
    ]);
  });

  it('adds dry-run and itemize-changes flags when requested', () => {
    const c = rsyncCommand({ distDir: '/build', deploy: local, dryRun: true });
    expect(c.args).toEqual(['-az', '--no-owner', '--no-group', '--no-perms', '--omit-dir-times', '--delete-delay', '--checksum', '--delay-updates', '--dry-run', '--itemize-changes', '/build/', '/ziel/']);
  });
});

describe('one job at a time', () => {
  const setup = async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await enableProjects(deps));
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
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
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
    expect(unwrap(await getPublish(deps, publishCtx, { id: history[0]!.id })).log.text).toContain('templateStale');
  });
});

describe('background jobs', () => {
  /**
   * Über MCP liefen Check, Vorschau und Publish in die Zeitüberschreitung des
   * Clients (01.10.): Sie bauen die Seite, und der erste Bau nach vielen neuen
   * Bildern erzeugt Tausende Varianten. Darum starten sie nur und kehren
   * sofort zurück; das Ergebnis liegt neben dem Riegel im Cache, nicht im
   * Speicher, weil Next jede Route eigens bündelt.
   */
  const envFor = (target: string | null) => ({
    publicUrl: 'https://staging.example.org',
    staging: true,
    deploy: target === null ? null : { host: '', user: '', path: target, auth: { kind: 'none' as const } },
    templateDir: TEMPLATE_DIR,
    cacheDir: tmp(),
    previewDir: tmp(),
  });
  const setup = () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    return deps;
  };
  const withTemplate = async () => {
    const deps = setup();
    unwrap(await enableProjects(deps));
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: TEMPLATE_DIR, confirm: true }));
    return deps;
  };
  /** Wartet, bis der Hintergrundlauf den Riegel wieder freigibt. */
  const settle = async (env: { cacheDir: string }) => {
    for (let i = 0; i < 4800 && runningSiteJob(env as never); i++) await new Promise((r) => setTimeout(r, 50));
  };
  const started = (r: Awaited<ReturnType<typeof startPreview>>) => {
    const value = unwrap(r);
    if (!value.started) throw new Error('nicht gestartet');
    return value;
  };

  it('needs the publish permission to start and to read, and a known kind', async () => {
    const deps = setup();
    const view = ctxWith(['site.view']);
    for (const denied of [
      await startDeployCheck(deps, view, envFor(tmp()), { source: 'ui' }),
      await startPreview(deps, view, envFor(tmp()), { source: 'ui' }),
      await startPublish(deps, view, envFor(tmp()), { confirm: true, source: 'ui' }),
      lastSiteJob(deps, view, envFor(tmp()), { kind: 'preview' }),
    ]) {
      expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
    }
    const unknown = lastSiteJob(deps, ctxWith(['site.publish']), envFor(tmp()), { kind: 'deploy' });
    expect(unknown.ok === false && unknown.error.type === 'validation').toBe(true);
  });

  it('refuses before anything runs what it can tell up front', async () => {
    const deps = setup();
    const ctx = ctxWith(['site.publish']);
    const env = envFor(null);
    const noTarget = await startDeployCheck(deps, ctx, env, { source: 'ui' });
    expect(noTarget.ok === false && noTarget.error.type === 'conflict' && noTarget.error.code === 'publishTargetMissing').toBe(true);
    const noConfirm = await startPublish(deps, ctx, envFor(tmp()), { confirm: false, source: 'ui' });
    expect(noConfirm.ok === false && noConfirm.error.type === 'validation').toBe(true);
    expect(runningSiteJob(env)).toBeNull();
    expect(unwrap(lastSiteJob(deps, ctx, env, { kind: 'deployCheck' }))).toEqual({ running: null, last: null });
  });

  it('returns at once, reports the run, and keeps the result with time and person', async () => {
    const deps = setup();
    const target = tmp();
    writeFileSync(path.join(target, 'wp-config.php'), '<?php');
    const env = envFor(target);
    const ctx = ctxWith(['site.publish']);

    const run = started(await startDeployCheck(deps, ctx, env, { source: 'ui' }));
    const startedAt = deps.clock.now().toISOString();
    expect(run).toEqual({ started: true, runId: expect.any(String), startedAt });
    expect(runningSiteJob(env)).toMatchObject({ kind: 'deployCheck', runId: run.runId, startedAt, source: 'ui' });

    // Ein zweiter Start während des Laufs meldet den laufenden, statt zu warten —
    // auch wenn er eine andere Art ist.
    const running = expect.objectContaining({ kind: 'deployCheck', runId: run.runId, source: 'ui' });
    expect(unwrap(await startDeployCheck(deps, ctx, env, { source: 'ui' }))).toEqual({ started: false, running });
    expect(unwrap(await startPreview(deps, ctx, env, { source: 'ui' }))).toEqual({ started: false, running });
    expect(unwrap(lastSiteJob(deps, ctx, env, { kind: 'deployCheck' })).running).toEqual(running);

    await settle(env);
    const { running: after, last } = unwrap(lastSiteJob(deps, ctx, env, { kind: 'deployCheck' }));
    expect(after).toBeNull();
    expect(last).toMatchObject({ kind: 'deployCheck', runId: run.runId, startedAt, finishedAt: startedAt, userId: ctx.userId });
    expect((last?.result as { filesAtTarget: string[] }).filesAtTarget).toEqual(['wp-config.php']);
    expect(last?.error).toBeUndefined();
    // Je Art ein eigener letzter Lauf.
    expect(unwrap(lastSiteJob(deps, ctx, env, { kind: 'preview' })).last).toBeNull();
  }, 240_000);

  it('keeps a failed check as a verdict, not an error, and opens the guard again', async () => {
    const deps = setup();
    const env = envFor(path.join(tmp(), 'vertippt'));
    const ctx = ctxWith(['site.publish']);

    started(await startDeployCheck(deps, ctx, env, { source: 'ui' }));
    await settle(env);

    const { last } = unwrap(lastSiteJob(deps, ctx, env, { kind: 'deployCheck' }));
    expect(last?.error).toBeUndefined();
    expect(last?.status).toBe('success');
    expect(last?.result).toMatchObject({ passed: false });
    expect(runningSiteJob(env)).toBeNull();
  }, 240_000);

  it('builds the preview in the background and keeps what the page shows', async () => {
    const deps = await withTemplate();
    const env = envFor(tmp());
    const ctx = ctxWith(['site.publish', 'site.view']);

    const run = started(await startPreview(deps, ctx, env, { source: 'ui' }));
    expect(runningSiteJob(env)?.kind).toBe('preview');
    await settle(env);

    const { last } = unwrap(lastSiteJob(deps, ctx, env, { kind: 'preview' }));
    expect(last).toMatchObject({ kind: 'preview', runId: run.runId });
    const result = last?.result as { diff: { added: string[] }; violations: unknown[]; previewDir: string; contentHash: string };
    expect(result.violations).toEqual([]);
    expect(result.diff.added.length).toBeGreaterThan(0);
    expect(result.previewDir).toBe(env.previewDir);
    expect(readFileSync(path.join(env.previewDir, 'index.html'), 'utf8')).toContain('<html');
  }, 240_000);

  it('publishes in the background, records the publish, and keeps the result', async () => {
    const deps = await withTemplate();
    const target = tmp();
    const env = envFor(target);
    const ctx = ctxWith(['site.publish', 'site.view']);

    const run = started(await startPublish(deps, ctx, env, { confirm: true, source: 'ui' }));
    expect(runningSiteJob(env)?.kind).toBe('publish');
    await settle(env);

    const { last } = unwrap(lastSiteJob(deps, ctx, env, { kind: 'publish' }));
    expect(last).toMatchObject({ kind: 'publish', runId: run.runId, result: { status: 'success' } });
    expect(readFileSync(path.join(target, 'index.html'), 'utf8')).toContain('<html');
    const history = unwrap(await listPublishes(deps, ctx, { environment: 'test' }));
    expect(history.map((h) => h.status)).toEqual(['success']);
  }, 240_000);

  it('keeps a blocked publish as an error, records the attempt, and opens the guard again', async () => {
    const deps = await withTemplate();
    const manage = ctxWith(['site.manage', 'settings.manage']);
    unwrap(await setSetting(deps, manage, { key: 'site.blockedTerms', value: ['strenggeheim'] }));
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'strenggeheim' } } }));
    const env = envFor(tmp());
    const ctx = ctxWith(['site.publish', 'site.view']);

    started(await startPublish(deps, ctx, env, { confirm: true, source: 'ui' }));
    await settle(env);

    const { last } = unwrap(lastSiteJob(deps, ctx, env, { kind: 'publish' }));
    expect(last?.result).toBeUndefined();
    expect(last?.error).toMatchObject({ type: 'conflict', code: 'blockedTermsPresent' });
    expect(unwrap(await listPublishes(deps, ctx, { environment: 'test' })).map((h) => h.status)).toEqual(['aborted']);
    expect(runningSiteJob(env)).toBeNull();
  }, 240_000);
});

describe('limits and abort', () => {
  const setupLimits = async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await enableProjects(deps));
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: TEMPLATE_DIR, confirm: true }));
    const env = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: { host: '', user: '', path: tmp(), auth: { kind: 'none' as const } },
      templateDir: TEMPLATE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
      workDir: tmp(),
      limits: { build: { totalMs: 1 } },
    };
    return { deps, env, ctx: ctxWith(['site.publish', 'site.view']) };
  };

  it('ends a preview at its time limit, names the step, leaves nothing behind', async () => {
    const { deps, env, ctx } = await setupLimits();
    const result = await runPreview(deps, ctx, env);
    expect(result).toMatchObject({ ok: false, error: { type: 'conflict', code: 'stepTimedOut', messageKey: 'site.publish.job.errors.stepTimedOut', params: { step: 'build' } } });
    const record = JSON.parse(readFileSync(path.join(env.cacheDir, 'preview-result.json'), 'utf8'));
    expect(record).toMatchObject({ status: 'aborted', reason: 'timeout', lastStep: 'build' });
    expect(readdirSync(env.workDir).filter((n) => n.startsWith('kompass-sitejob-'))).toEqual([]);
    expect(runningSiteJob(env)).toBeNull();
  }, 240_000);

  it('records a publish that hit its limit as aborted', async () => {
    const { deps, env, ctx } = await setupLimits();
    const result = await runPublish(deps, ctx, env, { confirm: true });
    expect(result).toMatchObject({ ok: false, error: { code: 'stepTimedOut' } });
    const history = unwrap(await listPublishes(deps, ctx, { environment: 'test' }));
    expect(history.map((h) => h.status)).toEqual(['aborted']);
    expect(history[0]!.summary).toContain('timeout');
  }, 240_000);
});

describe('runningSiteJob', () => {
  /**
   * Wer den Tab schliesst, sieht nicht, dass noch gebaut wird. Die Seite fragt
   * deshalb nach, was gerade laeuft und seit wann — auch nach dem Neuladen.
   */
  it('names the running job with its start, and is empty afterwards', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await enableProjects(deps));
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: TEMPLATE_DIR, confirm: true }));
    const env = {
      publicUrl: 'https://staging.example.org',
      staging: true,
      deploy: null,
      templateDir: TEMPLATE_DIR,
      cacheDir: tmp(),
      previewDir: tmp(),
    };
    expect(runningSiteJob(env)).toBeNull();
    const running = runPreview(deps, ctxWith(['site.publish', 'site.view']), env);
    expect(runningSiteJob(env)).toMatchObject({ kind: 'preview', runId: expect.any(String), startedAt: deps.clock.now().toISOString() });
    unwrap(await running);
    expect(runningSiteJob(env)).toBeNull();
  }, 240_000);

  /**
   * Ein Neustart mitten im Lauf hinterlässt die Datei. Im Container bekommt
   * Node danach meist dieselbe Prozessnummer — die Datei darf trotzdem nicht
   * als laufender Job gelten, sonst stünde der Riegel für immer. Ihr Lauf
   * steht danach als „unterbrochen“ da, ein Publish auch in der Historie.
   */
  it('settles a job file left by another process once, even with the same pid', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    insertUser(deps, { id: 'USER-TEST' });
    const env = { publicUrl: null, staging: false, deploy: null, templateDir: TEMPLATE_DIR, cacheDir: tmp(), previewDir: tmp(), workDir: tmp() };
    const ctx = ctxWith(['site.publish', 'site.view']);
    writeFileSync(
      path.join(env.cacheDir, 'running-job.json'),
      JSON.stringify({ kind: 'publish', runId: 'R1', startedAt: '2026-10-01T10:00:00.000Z', userId: 'USER-TEST', pid: process.pid, process: 'ein-anderer-prozess', steps: [{ key: 'transfer', state: 'running' }] }),
    );
    for (let i = 0; i < 2; i++) {
      const { running, last } = unwrap(lastSiteJob(deps, ctx, env, { kind: 'publish' }));
      expect(running).toBeNull();
      expect(last).toMatchObject({ runId: 'R1', status: 'interrupted', lastStep: 'transfer' });
    }
    const history = unwrap(await listPublishes(deps, ctx, { environment: 'test' }));
    expect(history.map((h) => h.status)).toEqual(['aborted']);
    expect(history[0]!.summary).toContain('unterbrochen');
    expect(unwrap(await startPreview(deps, ctx, { ...env, publicUrl: null }, { source: 'ui' }))).toMatchObject({ started: true });
  });

  it('understands a job file of 0.2.4 without crashing', () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: LOCALES });
    const env = { publicUrl: null, staging: false, deploy: null, templateDir: TEMPLATE_DIR, cacheDir: tmp(), previewDir: tmp(), workDir: tmp() };
    writeFileSync(path.join(env.cacheDir, 'running-job.json'), JSON.stringify({ name: 'preview', runId: 'R0', startedAt: '2026-10-01T10:00:00.000Z', process: 'alt' }));
    const { running, last } = unwrap(lastSiteJob(deps, ctxWith(['site.publish']), env, { kind: 'preview' }));
    expect(running).toBeNull();
    expect(last).toMatchObject({ runId: 'R0', status: 'interrupted' });
  });
});

describe('siteJobElapsedMs', () => {
  /**
   * Die Anzeige darf sich nicht auf die Uhr im Browser verlassen — eine falsch
   * gehende Client-Uhr zeigte sonst ab dem ersten Tick einen falschen Stand.
   * Beide Seiten der Rechnung kommen deshalb aus derselben Server-Uhr.
   */
  it('counts using only the server clock, never wall time', () => {
    const clock = fixedClock('2026-09-18T14:10:33.079Z');
    const job = { startedAt: clock.now().toISOString() };
    expect(siteJobElapsedMs(job, clock)).toBe(0);
    clock.advance(21_000);
    expect(siteJobElapsedMs(job, clock)).toBe(21_000);
  });
});
