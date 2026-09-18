import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps } from '../src/app';
import { login } from '../src/auth/login';
import { exportBackup, importBackup, importBackupForSetup, inspectBackup } from '../src/backup';
import { auditLog, users } from '../src/db/schema';
import { storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { seedDevelopment } from '../src/seed/seed';
import { readSetting } from '../src/settings/service';
import { ctxWith } from '../src/testing';
import { isSetupRequired } from '../src/setup/service';

// 1×1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fileDeps(dir: string, env: 'test' | 'production' = 'test') {
  return createDeps({ dataPath: dir, env });
}

describe('backup', () => {
  it('exports a tar.gz with manifest, db copy without sessions/tokens, and media; records lastExportAt', async () => {
    const dir = tmp();
    const deps = fileDeps(dir);
    const seed = await seedDevelopment(deps);
    unwrap(await login(deps, { email: seed.adminEmail, password: seed.adminPassword, ipAddress: null, requestId: 'R' }));
    const admin = deps.db.select().from(users).all()[0]!;
    const result = unwrap(await exportBackup(deps, ctxWith(['backup.export'], admin.id), { workDir: tmp() }));
    expect(result.archivePath).toMatch(/kompass-backup-test-\d{8}-\d{6}\.tar\.gz$/);
    expect(result.manifest).toMatchObject({ format: 2, environment: 'test', counts: { users: 4 } });
    const out = tmp();
    await tar.extract({ file: result.archivePath, cwd: out });
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    expect(manifest.migrationCount).toBe(deps.migrationCount);
    const copy = new Database(path.join(out, 'data', 'core', 'db', 'kompass.db'), { readonly: true });
    expect((copy.prepare('select count(*) as n from sessions').get() as { n: number }).n).toBe(0);
    expect((copy.prepare('select count(*) as n from api_tokens').get() as { n: number }).n).toBe(0);
    expect((copy.prepare('select count(*) as n from users').get() as { n: number }).n).toBe(4);
    copy.close();
    expect(typeof readSetting(deps, 'system.lastExportAt')).toBe('string');
    expect(deps.db.select().from(auditLog).all().some((e) => e.action === 'backup.export')).toBe(true);
    deps.close();
  });

  it('imports into another installation, invalidates sessions and logs a system entry', async () => {
    const source = fileDeps(tmp());
    const seed = await seedDevelopment(source);
    const admin = source.db.select().from(users).all()[0]!;
    const exported = unwrap(await exportBackup(source, ctxWith(['backup.export'], admin.id), { workDir: tmp() }));
    source.close();

    const target = fileDeps(tmp());
    expect(isSetupRequired(target)).toBe(true);
    const inspected = unwrap(await inspectBackup({ archivePath: exported.archivePath, workDir: tmp() }));
    expect(inspected.counts.users).toBe(4);
    const importer = ctxWith(['backup.import'], null);
    const wrong = await importBackup(target, importer, { archivePath: exported.archivePath, workDir: tmp(), confirmation: 'produktion', environmentName: 'test' });
    expect(wrong.ok === false && wrong.error.type === 'validation' && wrong.error.issues[0]?.message === 'confirmationMismatch').toBe(true);
    const done = unwrap(await importBackup(target, importer, { archivePath: exported.archivePath, workDir: tmp(), confirmation: 'test', environmentName: 'test' }));
    expect(done.manifest.counts.users).toBe(4);
    expect(isSetupRequired(target)).toBe(false);
    expect((await login(target, { email: seed.adminEmail, password: seed.adminPassword, ipAddress: null, requestId: 'R' })).ok).toBe(true);
    expect(readSetting(target, 'system.lastImportAt')).not.toBeNull();
    const last = target.db.select().from(auditLog).all().filter((e) => e.action === 'backup.import').at(-1)!;
    expect(last).toMatchObject({ action: 'backup.import', channel: 'system', userId: null });
    target.close();
  });

  it('rejects archives with an unsupported format and requires backup.import', async () => {
    const dir = tmp();
    const deps = fileDeps(dir);
    const bad = path.join(dir, 'bad.tar.gz');
    const work = tmp();
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(path.join(work, 'src'), { recursive: true });
    writeFileSync(path.join(work, 'src', 'manifest.json'), JSON.stringify({ format: 99 }));
    await tar.create({ gzip: true, cwd: path.join(work, 'src'), file: bad }, ['manifest.json']);
    const result = await importBackup(deps, ctxWith(['backup.import']), { archivePath: bad, workDir: tmp(), confirmation: 'test', environmentName: 'test' });
    expect(result.ok === false && result.error.type === 'validation' && result.error.issues[0]?.message === 'backupFormatUnsupported').toBe(true);
    expect((await exportBackup(deps, ctxWith([]), { workDir: tmp() })).ok).toBe(false);
    deps.close();
  });

  it('legt den ganzen Bestand als eine Rueckfahrkarte beiseite und raeumt die vorige weg', async () => {
    const source = tmp();
    const sourceDeps = fileDeps(source);
    const seed = await seedDevelopment(sourceDeps);
    const admin = sourceDeps.db.select().from(users).all()[0]!;
    const ctx = ctxWith(['backup.export', 'backup.import'], admin.id);
    unwrap(await storeMediaAsset(sourceDeps, ctxWith(['media.upload'], admin.id), { originalName: 'neu.png', bytes: PNG }));
    const archive = unwrap(await exportBackup(sourceDeps, ctx, { workDir: tmp() }));
    sourceDeps.close();

    const target = tmp();
    const targetDeps = fileDeps(target);
    await seedDevelopment(targetDeps);
    const mediaRoot = path.join(target, 'core', 'media');
    mkdirSync(mediaRoot, { recursive: true });
    writeFileSync(path.join(mediaRoot, 'alt.png'), 'alt');
    // Eine Rueckfahrkarte aus einem frueheren Lauf, die verschwinden soll.
    mkdirSync(path.join(target, '.before-import-20250101T000000'), { recursive: true });

    unwrap(await importBackup(targetDeps, ctx, {
      archivePath: archive.archivePath,
      workDir: tmp(),
      confirmation: 'test',
      environmentName: 'test',
    }));

    const entries = readdirSync(mediaRoot);
    expect(entries.some((e) => e.startsWith('neu'))).toBe(true);
    expect(entries).not.toContain('alt.png');

    const asides = readdirSync(target).filter((e) => e.startsWith('.before-import-'));
    expect(asides, 'genau eine Rueckfahrkarte').toHaveLength(1);
    expect(asides[0]).not.toBe('.before-import-20250101T000000');
    expect(readdirSync(path.join(target, asides[0]!, 'core', 'media'))).toContain('alt.png');
    expect(seed.adminEmail).toContain('@');
    targetDeps.close();
  });
});

describe('importBackupForSetup', () => {
  async function seededArchive(): Promise<string> {
    const deps = fileDeps(tmp());
    await seedDevelopment(deps);
    const archive = unwrap(await exportBackup(deps, ctxWith(['backup.export']), { workDir: tmp() }));
    deps.close();
    return archive.archivePath;
  }

  it('imports into an empty installation and records a system entry without a user', async () => {
    const archivePath = await seededArchive();
    const deps = fileDeps(tmp());
    expect(isSetupRequired(deps)).toBe(true);

    const result = unwrap(await importBackupForSetup(deps, { archivePath, workDir: tmp() }));
    expect(result.manifest.environment).toBe('test');
    expect(isSetupRequired(deps)).toBe(false);

    const entry = deps.db.select().from(auditLog).all().find((e) => e.action === 'backup.import');
    expect(entry).toBeTruthy();
    expect(entry!.userId).toBeNull();
    expect(entry!.channel).toBe('system');
    deps.close();
  });

  it('refuses once the installation has a user', async () => {
    const archivePath = await seededArchive();
    const deps = fileDeps(tmp());
    await seedDevelopment(deps);
    const result = await importBackupForSetup(deps, { archivePath, workDir: tmp() });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'conflict') expect(result.error.code).toBe('setupAlreadyDone');
    deps.close();
  });

  it('refuses an archive without users, which would leave the installation open and unusable', async () => {
    const empty = fileDeps(tmp());
    const archive = unwrap(await exportBackup(empty, ctxWith(['backup.export']), { workDir: tmp() }));
    empty.close();

    const deps = fileDeps(tmp());
    const result = await importBackupForSetup(deps, { archivePath: archive.archivePath, workDir: tmp() });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'validation') {
      expect(result.error.issues[0]!.message).toBe('backupWithoutUsers');
    }
    deps.close();
  });
});
