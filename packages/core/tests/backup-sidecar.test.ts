import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupManifestSchema } from '../src/backup/manifest';
import { BACKUP_WORK_PREFIX } from '../src/backup/paths';
import {
  backupFileName,
  backupFiles,
  isBackupName,
  listBackups,
  newestVerifiedBackup,
  readSidecar,
  uniqueBackupName,
  writeSidecar,
  type BackupSidecar,
} from '../src/backup/sidecar';

describe('Manifest Format 3', () => {
  it('nimmt nur Format 3 mit Dateiliste', () => {
    const m = {
      format: 3,
      appVersion: '0.3.2',
      createdAt: '2026-10-23T01:00:00.000Z',
      environment: 'test',
      migrationCount: 11,
      counts: { users: 1, auditEntries: 2, mediaAssets: 0, records: { 'dms.documents': 4 } },
      files: [{ path: 'data/core/db/kompass.db', size: 4096 }],
    };
    expect(backupManifestSchema.safeParse(m).success).toBe(true);
    expect(backupManifestSchema.safeParse({ ...m, format: 2 }).success).toBe(false);
    expect(backupManifestSchema.safeParse({ ...m, files: [{ path: '../x', size: 1 }] }).success).toBe(false);
    expect(backupManifestSchema.safeParse({ ...m, files: [{ path: 'data/a/../../x', size: 1 }] }).success).toBe(false);
  });
});

describe('Begleitdatei, Namen, Liste', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function tmp(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-sidecar-'));
    dirs.push(dir);
    return dir;
  }
  function sidecar(over: Partial<BackupSidecar> & { name: string }): BackupSidecar {
    return {
      version: 1,
      kind: 'automatic',
      createdAt: '2026-10-20T03:00:00.000Z',
      sizeBytes: 3,
      sha256: null,
      manifest: null,
      verification: { status: 'unverified' },
      pinned: false,
      pinnedLabel: null,
      ...over,
    };
  }

  it('baut den Dateinamen aus Umgebung, Zeitpunkt und Art', () => {
    expect(backupFileName('production', '2026-10-23T01:02:03.000Z', 'automatic')).toBe('kompass-backup-production-20261023-010203-automatic');
  });

  it('hängt in derselben Sekunde -2, -3 an, statt zu überschreiben', () => {
    const dir = tmp();
    const base = 'kompass-backup-test-20261023-010203-manual';
    expect(uniqueBackupName(dir, base)).toBe(base);
    writeFileSync(path.join(dir, `${base}.tar`), '');
    expect(uniqueBackupName(dir, base)).toBe(`${base}-2`);
    writeFileSync(path.join(dir, `${base}-2.json`), '{}');
    expect(uniqueBackupName(dir, base)).toBe(`${base}-3`);
  });

  it('lässt nur einfache Namen im Verzeichnis zu', () => {
    const dir = tmp();
    expect(isBackupName('../etc/passwd')).toBe(false);
    expect(isBackupName('.work-01J')).toBe(false);
    expect(isBackupName('x.tar')).toBe(false);
    expect(isBackupName('kompass-backup-test-20261023-010203-manual')).toBe(true);
    expect(backupFiles(dir, 'a/b')).toBeNull();
    expect(backupFiles(dir, '..')).toBeNull();
    expect(backupFiles(dir, 'gut')).toEqual({ archive: path.join(dir, 'gut.tar'), sidecar: path.join(dir, 'gut.json') });
  });

  it('schreibt die Begleitdatei atomar und liest kaputtes JSON als fehlend', () => {
    const dir = tmp();
    const s = sidecar({ name: 'eins', pinned: true, pinnedLabel: 'Jahresabschluss' });
    writeSidecar(dir, s);
    expect(readSidecar(dir, 'eins')).toEqual(s);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    writeFileSync(path.join(dir, 'kaputt.json'), '{nicht json');
    expect(readSidecar(dir, 'kaputt')).toBeNull();
    expect(readSidecar(dir, 'fehlt')).toBeNull();
  });

  it('listet Archive neueste zuerst, ohne Waisen und Arbeitsdateien', () => {
    const dir = tmp();
    const older = 'kompass-backup-test-20261022-030000-automatic';
    writeSidecar(dir, sidecar({ name: older, createdAt: '2026-10-22T03:00:00.000Z', verification: { status: 'passed', at: '2026-10-22T03:01:00.000Z' } }));
    writeFileSync(path.join(dir, `${older}.tar`), 'abc');
    writeFileSync(path.join(dir, 'handabgelegt.tar'), 'x');
    const mtime = new Date('2026-10-23T08:00:00.000Z');
    utimesSync(path.join(dir, 'handabgelegt.tar'), mtime, mtime);
    writeSidecar(dir, sidecar({ name: 'verwaist' }));
    writeFileSync(path.join(dir, `${BACKUP_WORK_PREFIX}123.tar`), 'x');
    const items = listBackups(dir);
    expect(items.map((i) => i.name)).toEqual(['handabgelegt', older]);
    expect(items.find((i) => i.name === 'handabgelegt')).toMatchObject({
      kind: 'unknown',
      hasSidecar: false,
      createdAt: mtime.toISOString(),
      verification: { status: 'unverified' },
      sizeBytes: 1,
      manifest: null,
      sha256: null,
      pinned: false,
      pinnedLabel: null,
    });
    expect(items.find((i) => i.name === older)).toMatchObject({ kind: 'automatic', hasSidecar: true });
    // Nur „passed“ zählt, das neuere ungeprüfte nicht.
    expect(newestVerifiedBackup(dir)?.name).toBe(older);
  });

  it('liefert für ein fehlendes Verzeichnis eine leere Liste', () => {
    expect(listBackups(path.join(tmp(), 'fehlt'))).toEqual([]);
    expect(newestVerifiedBackup(path.join(tmp(), 'fehlt'))).toBeNull();
  });
});
