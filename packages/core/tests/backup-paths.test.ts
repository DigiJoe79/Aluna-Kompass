import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readEnv } from '../src/app';
import { assertBackupPathOutsideData, backupMountWarning } from '../src/backup/paths';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-backup-paths-'));
  dirs.push(dir);
  return dir;
}

describe('BACKUP_PATH', () => {
  it('verweigert BACKUP_PATH in oder gleich DATA_PATH', () => {
    expect(() => assertBackupPathOutsideData('/x/data', '/x/data')).toThrow(/BACKUP_PATH liegt in DATA_PATH/);
    expect(() => assertBackupPathOutsideData('/x/data/backups', '/x/data')).toThrow(/BACKUP_PATH liegt in DATA_PATH/);
    expect(() => assertBackupPathOutsideData('/x/data/../data/b', '/x/data')).toThrow();
    expect(() => assertBackupPathOutsideData('/x/backups', '/x/data')).not.toThrow();
    expect(() => assertBackupPathOutsideData('/x/data-backups', '/x/data')).not.toThrow();
  });

  it('warnt nur im Image, wenn BACKUP_PATH auf dem Datenträger der Wurzel liegt', () => {
    const dir = tmp();
    expect(backupMountWarning(dir, { inImage: false, rootPath: dir })).toBeNull();
    expect(backupMountWarning(dir, { inImage: true, rootPath: dir })).toBe('notMounted');
    // Ein fehlendes Verzeichnis meldet B4 als Fehler, nicht diese Warnung.
    expect(backupMountWarning(path.join(dir, 'fehlt'), { inImage: true, rootPath: dir })).toBeNull();
  });

  it('readEnv liest BACKUP_PATH mit Vorgabe ./backups und KOMPASS_IN_IMAGE', () => {
    const base = { SESSION_SECRET: 'x'.repeat(32) };
    expect(readEnv(base)).toMatchObject({ backupPath: './backups', inImage: false });
    expect(readEnv({ ...base, BACKUP_PATH: '/b', KOMPASS_IN_IMAGE: '1' })).toMatchObject({ backupPath: '/b', inImage: true });
  });
});
