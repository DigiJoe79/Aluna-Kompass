import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSidecar } from '../src/backup/sidecar';
import { backupStorage, backupStorageSync } from '../src/backup/storage';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-storage-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function archive(bp: string, name: string, size: number, createdAt: string, status: 'passed' | 'failed') {
  writeFileSync(path.join(bp, `${name}.tar`), Buffer.alloc(size));
  writeSidecar(bp, {
    version: 1,
    name,
    kind: 'manual',
    createdAt,
    sizeBytes: size,
    sha256: null,
    manifest: null,
    verification: status === 'passed' ? { status, at: createdAt } : { status, at: createdAt, reason: 'backupCorrupt' },
    pinned: false,
    pinnedLabel: null,
  });
}

const statfs = { bavail: 500, bsize: 1, blocks: 10_000 } as fs.StatsFs;

describe('Speicherplatz für Backups', () => {
  it('rechnet belegt, frei und die Vorwarnung aus dem neuesten geprüften Backup', async () => {
    const bp = tmp();
    archive(bp, 'alt', 100, '2026-10-20T03:00:00.000Z', 'passed');
    archive(bp, 'neu', 300, '2026-10-22T03:00:00.000Z', 'passed');
    archive(bp, 'kaputt', 50, '2026-10-23T03:00:00.000Z', 'failed');
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue(statfs);
    vi.spyOn(fs, 'statfsSync').mockReturnValue(statfs);
    const expected = { usedBytes: 450, freeBytes: 500, totalBytes: 10_000, referenceBytes: 300, low: true };
    expect(await backupStorage(bp)).toEqual(expected);
    expect(backupStorageSync(bp)).toEqual(expected);
  });

  it('genug Platz → keine Vorwarnung; ohne geprüftes Backup keine Vorwarnung; ohne Verzeichnis null', async () => {
    const bp = tmp();
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue(statfs);
    archive(bp, 'kaputt', 400, '2026-10-23T03:00:00.000Z', 'failed');
    expect(await backupStorage(bp)).toMatchObject({ referenceBytes: null, low: false });
    archive(bp, 'klein', 250, '2026-10-22T03:00:00.000Z', 'passed');
    expect(await backupStorage(bp)).toMatchObject({ referenceBytes: 250, low: false });
    vi.restoreAllMocks();
    expect(await backupStorage(path.join(bp, 'fehlt'))).toBeNull();
    expect(backupStorageSync(path.join(bp, 'fehlt'))).toBeNull();
  });
});
