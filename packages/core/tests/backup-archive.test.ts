import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupTooLargeError, extractBackup, isAllowedBackupEntry } from '../src/backup/archive';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-archive-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('isAllowedBackupEntry', () => {
  it('accepts the manifest and the whole data tree', () => {
    expect(isAllowedBackupEntry('manifest.json')).toBe(true);
    expect(isAllowedBackupEntry('./manifest.json')).toBe(true);
    expect(isAllowedBackupEntry('data/core/db/kompass.db')).toBe(true);
    expect(isAllowedBackupEntry('data/core/media/foto-abc123.png')).toBe(true);
    // Ein Modul, das es heute noch nicht gibt, ist ohne Codeaenderung dabei.
    expect(isAllowedBackupEntry('data/dms/BRF-2026-001.pdf')).toBe(true);
    // Der Export packt `data` selbst mit; ohne diesen Eintrag entstuende das
    // Verzeichnis bei einem leeren Bestand nicht.
    expect(isAllowedBackupEntry('data')).toBe(true);
    expect(isAllowedBackupEntry('data/')).toBe(true);
  });

  it('rejects escapes and anything outside the data tree', () => {
    expect(isAllowedBackupEntry('../etc/passwd')).toBe(false);
    expect(isAllowedBackupEntry('data/../../etc/passwd')).toBe(false);
    expect(isAllowedBackupEntry('/etc/passwd')).toBe(false);
    // Geheimnisse liegen ausserhalb von `dataPath` und kaemen gar nicht erst
    // ins Archiv — hier steht, dass sie es auch beim Entpacken nicht tun.
    expect(isAllowedBackupEntry('secret/site.pw')).toBe(false);
    expect(isAllowedBackupEntry('site.pw')).toBe(false);
    expect(isAllowedBackupEntry('kompass.db')).toBe(false);
  });
});

function archiveWith(entries: Record<string, string>): string {
  const src = tmp();
  for (const [name, content] of Object.entries(entries)) {
    const file = path.join(src, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const out = path.join(tmp(), 'backup.tar.gz');
  tar.create({ file: out, cwd: src, gzip: true, sync: true }, Object.keys(entries));
  return out;
}

describe('extractBackup', () => {
  it('unpacks the expected entries and drops the rest', async () => {
    const archive = archiveWith({
      'manifest.json': '{}',
      'data/core/db/kompass.db': 'db',
      'data/core/media/foto.png': 'bild',
      'fremd.txt': 'weg damit',
    });
    const dir = await extractBackup({ archivePath: archive, workDir: tmp() });
    const { existsSync, readdirSync } = await import('node:fs');
    expect(readdirSync(dir).sort()).toEqual(['data', 'manifest.json']);
    expect(existsSync(path.join(dir, 'fremd.txt'))).toBe(false);
  });

  it('refuses an oversized archive without taking the process down', async () => {
    const archive = archiveWith({ 'manifest.json': '{}', 'data/core/db/kompass.db': 'x'.repeat(4096) });
    await expect(extractBackup({ archivePath: archive, workDir: tmp(), maxBytes: 100 })).rejects.toThrow(
      BackupTooLargeError,
    );
  });
});
