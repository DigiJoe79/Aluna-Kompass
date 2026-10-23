import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps } from '../src/app';
import { login } from '../src/auth/login';
import { launchBackupCreate } from '../src/backup/create';
import { auditLog, users } from '../src/db/schema';
import { unwrap } from '../src/result';
import { seedDevelopment } from '../src/seed/seed';
import { ctxWith } from '../src/testing';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// Echte Ein- und Ausgabe (Migrationen, SQLite-Kopie, tar): allein 1–1,7 s je Fall, im vollen `pnpm verify` neben den
// App-Tests mehrfach über den 5-s-Vorgabewert (2026-10-17, dreimal in vier Läufen). Mehr Zeit statt eines Wacklers.
describe('backup', { timeout: 20_000 }, () => {
  it('exports an uncompressed tar (format 3) as a run into BACKUP_PATH, db copy without sessions/tokens', async () => {
    const dir = tmp();
    const deps = createDeps({ dataPath: dir, backupPath: tmp(), env: 'test' });
    const seed = await seedDevelopment(deps);
    unwrap(await login(deps, { email: seed.adminEmail, password: seed.adminPassword, ipAddress: null, requestId: 'R' }));
    const admin = deps.db.select().from(users).all()[0]!;
    const started = launchBackupCreate(deps, ctxWith(['backup.export'], admin.id), 'manual', 'ui');
    if ('busy' in started) throw new Error('busy');
    const result = unwrap(await started.done);
    const archivePath = path.join(deps.backupPath!, `${result.name}.tar`);
    expect(result.sidecar.manifest).toMatchObject({ format: 3, appVersion: deps.appVersion, environment: 'test', counts: { users: 4 } });
    const head = readFileSync(archivePath).subarray(0, 2);
    expect([head[0], head[1]]).not.toEqual([0x1f, 0x8b]);
    const out = tmp();
    await tar.extract({ file: archivePath, cwd: out });
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    expect(manifest.migrationCount).toBe(deps.migrationCount);
    const copy = new Database(path.join(out, 'data', 'core', 'db', 'kompass.db'), { readonly: true });
    expect((copy.prepare('select count(*) as n from sessions').get() as { n: number }).n).toBe(0);
    expect((copy.prepare('select count(*) as n from api_tokens').get() as { n: number }).n).toBe(0);
    expect((copy.prepare('select count(*) as n from users').get() as { n: number }).n).toBe(4);
    copy.close();
    expect(deps.db.select().from(auditLog).all().some((e) => e.action === 'backup.create')).toBe(true);
    deps.close();
  });
});
