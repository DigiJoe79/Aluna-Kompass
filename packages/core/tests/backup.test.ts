import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps } from '../src/app';
import { login } from '../src/auth/login';
import { exportBackup, importBackup, inspectBackup } from '../src/backup';
import { auditLog, users } from '../src/db/schema';
import { unwrap } from '../src/result';
import { seedDevelopment } from '../src/seed/seed';
import { readSetting } from '../src/settings/service';
import { ctxWith } from '../src/testing';
import { isSetupRequired } from '../src/setup/service';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fileDeps(dir: string, env: 'test' | 'production' = 'test') {
  return createDeps({ databasePath: path.join(dir, 'kompass.db'), mediaPath: path.join(dir, 'media'), env });
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
    expect(result.manifest).toMatchObject({ format: 1, environment: 'test', counts: { users: 4 } });
    const out = tmp();
    await tar.extract({ file: result.archivePath, cwd: out });
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    expect(manifest.migrationCount).toBe(deps.migrationCount);
    const copy = new Database(path.join(out, 'kompass.db'), { readonly: true });
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
});
