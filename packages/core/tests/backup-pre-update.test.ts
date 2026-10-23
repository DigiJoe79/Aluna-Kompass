import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps, databasePathIn } from '../src/app';
import { pendingMigrationCount, recordPreUpdateBackup, runPreUpdateBackup } from '../src/backup/pre-update';
import { listBackups } from '../src/backup/sidecar';
import { readBackupState, updateBackupState } from '../src/backup/state';
import { fixedClock } from '../src/clock';
import { migrationsFolder } from '../src/db/client';
import { auditEntry } from '../src/testing';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-pre-update-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(d, 0o700);
    } catch {
      // schon weg
    }
    rmSync(d, { recursive: true, force: true });
  }
});

/** Eine migrierte Datenbank; `drop` Zeilen aus `__drizzle_migrations` entfernt → so viele Migrationen stehen an. */
function installation(drop = 1) {
  const dataPath = tmp();
  const deps = createDeps({ dataPath, env: 'test', clock: fixedClock('2026-10-01T10:00:00.000Z') });
  deps.close();
  const dbPath = databasePathIn(dataPath);
  if (drop > 0) {
    const db = new Database(dbPath);
    db.prepare('DELETE FROM __drizzle_migrations WHERE rowid IN (SELECT rowid FROM __drizzle_migrations ORDER BY created_at DESC LIMIT ?)').run(drop);
    db.close();
  }
  return { dataPath, dbPath };
}

const day = (n: number) => new Date(Date.parse('2026-08-01T10:00:00.000Z') + n * 86_400_000);
const opts = (dataPath: string, backupPath: string, now: Date) => ({ dataPath, backupPath, env: 'test' as const, appVersion: '9.9.9', migrationsFolder: migrationsFolder(), now });

describe('Backup vor Update', { timeout: 30_000 }, () => {
  it('zählt anstehende Migrationen: Datei fehlt → 0, Tabelle fehlt → 0, eine Zeile weniger als das Journal → 1', () => {
    const empty = tmp();
    expect(pendingMigrationCount(path.join(empty, 'fehlt.db'), migrationsFolder())).toBe(0);
    const bare = path.join(empty, 'leer.db');
    new Database(bare).close();
    expect(pendingMigrationCount(bare, migrationsFolder())).toBe(0);
    expect(pendingMigrationCount(installation(0).dbPath, migrationsFolder())).toBe(0);
    expect(pendingMigrationCount(installation(1).dbPath, migrationsFolder())).toBe(1);
  });

  it('nichts anstehend → notNeeded, kein Archiv', async () => {
    const { dataPath } = installation(0);
    const bp = tmp();
    expect(await runPreUpdateBackup(opts(dataPath, bp, day(0)))).toEqual({ status: 'notNeeded' });
    expect(listBackups(bp)).toEqual([]);
  });

  it('sichert vor einer anstehenden Migration als Art preUpdate, prüft und räumt nach 30 Tagen, das neueste bleibt', async () => {
    const { dataPath } = installation(1);
    const bp = tmp();
    const names: string[] = [];
    for (const n of [0, 10, 45]) {
      const result = await runPreUpdateBackup(opts(dataPath, bp, day(n)));
      if (result.status !== 'done') throw new Error('kein Backup');
      expect(result.sidecar).toMatchObject({ kind: 'preUpdate', verification: { status: 'passed' }, manifest: { appVersion: '9.9.9' } });
      names.push(result.sidecar.name);
    }
    expect(listBackups(bp).map((i) => i.name)).toEqual([names[2]]);
    expect(existsSync(path.join(bp, `${names[0]}.tar`))).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('BACKUP_PATH nicht beschreibbar → wirft backupPathUnwritable und merkt preUpdateFailed (mailed false)', async () => {
    const { dataPath } = installation(1);
    const bp = tmp();
    updateBackupState(bp, {}); // .jobs anlegen, damit der Zustand geschrieben werden kann
    chmodSync(bp, 0o500);
    await expect(runPreUpdateBackup(opts(dataPath, bp, day(0)))).rejects.toThrow(/backupPathUnwritable/);
    chmodSync(bp, 0o700);
    expect(readBackupState(bp).lastError).toMatchObject({ code: 'backupPathUnwritable', kind: 'preUpdate', mailed: false });
  });

  it('recordPreUpdateBackup protokolliert backup.create als System und löscht den letzten Fehler', async () => {
    const { dataPath } = installation(1);
    const bp = tmp();
    const result = await runPreUpdateBackup(opts(dataPath, bp, day(0)));
    if (result.status !== 'done') throw new Error('kein Backup');
    updateBackupState(bp, { lastError: { code: 'preUpdateFailed', at: day(0).toISOString(), kind: 'preUpdate', name: null, reason: 'x', mailed: false } });
    // Nach dem Backup migriert der Start; hier eine frische Installation daneben.
    const deps = createDeps({ dataPath: tmp(), backupPath: bp, env: 'test', clock: fixedClock(day(0).toISOString()) });
    recordPreUpdateBackup(deps, result.sidecar);
    const entry = auditEntry(deps, 'backup.create');
    expect(entry).toMatchObject({ entityId: result.sidecar.name, channel: 'system', userId: null });
    expect(JSON.parse(entry.params!)).toEqual({ kind: 'preUpdate', sizeBytes: result.sidecar.sizeBytes });
    expect(readBackupState(bp).lastError).toBeNull();
    deps.close();
  });
});
