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
  it('accepts exactly the three kinds of entry a backup contains', () => {
    expect(isAllowedBackupEntry('manifest.json')).toBe(true);
    expect(isAllowedBackupEntry('kompass.db')).toBe(true);
    expect(isAllowedBackupEntry('media/foto-abc123.png')).toBe(true);
    expect(isAllowedBackupEntry('./manifest.json')).toBe(true);
    // Der Export packt das Medienverzeichnis selbst mit; ohne diesen Eintrag
    // entstuende es bei einem Backup ohne Medien nicht.
    expect(isAllowedBackupEntry('media')).toBe(true);
    expect(isAllowedBackupEntry('media/')).toBe(true);
  });

  it('rejects escapes and anything unexpected', () => {
    expect(isAllowedBackupEntry('../etc/passwd')).toBe(false);
    expect(isAllowedBackupEntry('media/../../etc/passwd')).toBe(false);
    expect(isAllowedBackupEntry('/etc/passwd')).toBe(false);
    expect(isAllowedBackupEntry('site.pw')).toBe(false);
    expect(isAllowedBackupEntry('kompass.db-wal')).toBe(false);
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
      'kompass.db': 'db',
      'media/foto.png': 'bild',
      'fremd.txt': 'weg damit',
    });
    const dir = await extractBackup({ archivePath: archive, workDir: tmp() });
    const { existsSync, readdirSync } = await import('node:fs');
    expect(readdirSync(dir).sort()).toEqual(['kompass.db', 'manifest.json', 'media']);
    expect(existsSync(path.join(dir, 'fremd.txt'))).toBe(false);
  });

  it('refuses an oversized archive without taking the process down', async () => {
    const archive = archiveWith({ 'manifest.json': '{}', 'kompass.db': 'x'.repeat(4096) });
    await expect(extractBackup({ archivePath: archive, workDir: tmp(), maxBytes: 100 })).rejects.toThrow(
      BackupTooLargeError,
    );
  });
});
