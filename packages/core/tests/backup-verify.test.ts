import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import tarStream from 'tar-stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps } from '../src/app';
import { BACKUP_WORK_PREFIX } from '../src/backup/paths';
import { verifyBackupArchive } from '../src/backup/verify';
import { backupSourceOf, createBackupArchive } from '../src/backup/write';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-verify-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function freshArchive() {
  const root = tmp();
  const backupDir = path.join(root, 'backups');
  const deps = createDeps({ dataPath: path.join(root, 'data'), backupPath: backupDir, env: 'test' });
  const archivePath = path.join(backupDir, 'frisch.tar');
  const out = await createBackupArchive(backupSourceOf(deps), { archivePath, workDir: backupDir, createdAt: '2026-10-23T01:00:00.000Z' });
  deps.close();
  return { archivePath, backupDir, out };
}

function sqliteBytes(): Buffer {
  const file = path.join(tmp(), 'probe.db');
  const db = new Database(file);
  db.exec('create table t (x integer); insert into t values (1);');
  db.close();
  return readFileSync(file);
}

function manifest(files: { path: string; size: number }[], format = 3) {
  return {
    format,
    appVersion: '0.3.2',
    createdAt: '2026-10-23T01:00:00.000Z',
    environment: 'test',
    migrationCount: 1,
    counts: { users: 0, auditEntries: 0, mediaAssets: 0, records: {} },
    files,
  };
}

/** Ein von Hand gebautes Archiv; `listed` übersteuert die Dateiliste des Manifests. */
async function craftTar(entries: { name: string; data: Buffer }[], opts: { listed?: { path: string; size: number }[]; format?: number } = {}): Promise<string> {
  const pack = tarStream.pack();
  const chunks: Buffer[] = [];
  pack.on('data', (c: unknown) => chunks.push(c as Buffer));
  const ended = new Promise<void>((resolve) => pack.on('end', () => resolve()));
  for (const e of entries) pack.entry({ name: e.name }, e.data);
  const listed = opts.listed ?? entries.map((e) => ({ path: e.name, size: e.data.length }));
  pack.entry({ name: 'manifest.json' }, Buffer.from(JSON.stringify(manifest(listed, opts.format))));
  pack.finalize();
  await ended;
  const file = path.join(tmp(), 'gebaut.tar');
  writeFileSync(file, Buffer.concat(chunks));
  return file;
}

const DB = 'data/core/db/kompass.db';

describe('verifyBackupArchive', { timeout: 20_000 }, () => {
  it('besteht für ein frisches Archiv und nennt dieselbe Prüfsumme', async () => {
    const { archivePath, backupDir, out } = await freshArchive();
    const v = await verifyBackupArchive(archivePath, { workDir: backupDir, expectedSha256: out.sha256 });
    expect(v).toMatchObject({ ok: true, sha256: out.sha256, sizeBytes: out.sizeBytes, manifest: { format: 3 } });
  });

  it.each([
    ['gzip aus 0.3.1', () => gzipSync(Buffer.from('x'))],
    ['kein tar', () => Buffer.from('hallo')],
    ['leere Datei', () => Buffer.alloc(0)],
  ])('%s → backupFormatUnsupported', async (_label, bytes) => {
    const dir = tmp();
    const file = path.join(dir, 'x.tar');
    writeFileSync(file, bytes());
    expect(await verifyBackupArchive(file, { workDir: dir })).toMatchObject({ ok: false, reason: 'backupFormatUnsupported' });
  });

  it('Manifest mit format 2 → backupFormatUnsupported', async () => {
    const file = await craftTar([{ name: DB, data: sqliteBytes() }], { format: 2 });
    expect(await verifyBackupArchive(file, { workDir: tmp() })).toMatchObject({ ok: false, reason: 'backupFormatUnsupported' });
  });

  it('besteht für ein gebautes, stimmiges Archiv', async () => {
    const file = await craftTar([{ name: DB, data: sqliteBytes() }, { name: 'data/x.txt', data: Buffer.from('abc') }]);
    expect(await verifyBackupArchive(file, { workDir: tmp() })).toMatchObject({ ok: true });
  });

  it('fehlende Datei der Liste → backupFileMissing', async () => {
    const db = sqliteBytes();
    const file = await craftTar([{ name: DB, data: db }], { listed: [{ path: DB, size: db.length }, { path: 'data/x.txt', size: 3 }] });
    expect(await verifyBackupArchive(file, { workDir: tmp() })).toMatchObject({ ok: false, reason: 'backupFileMissing' });
  });

  it('andere Größe → backupFileSizeMismatch', async () => {
    const db = sqliteBytes();
    const file = await craftTar([{ name: DB, data: db }, { name: 'data/x.txt', data: Buffer.from('abc') }], {
      listed: [{ path: DB, size: db.length }, { path: 'data/x.txt', size: 4 }],
    });
    expect(await verifyBackupArchive(file, { workDir: tmp() })).toMatchObject({ ok: false, reason: 'backupFileSizeMismatch' });
  });

  it('kaputte Datenbank → backupCorrupt', async () => {
    const file = await craftTar([{ name: DB, data: Buffer.from('dies ist keine Datenbank, nur Zufall'.repeat(200)) }]);
    expect(await verifyBackupArchive(file, { workDir: tmp() })).toMatchObject({ ok: false, reason: 'backupCorrupt' });
  });

  it('abweichende erwartete Prüfsumme → backupChecksumMismatch', async () => {
    const { archivePath, backupDir } = await freshArchive();
    expect(await verifyBackupArchive(archivePath, { workDir: backupDir, expectedSha256: '0'.repeat(64) })).toMatchObject({
      ok: false,
      reason: 'backupChecksumMismatch',
    });
  });

  it('abgeschnittenes Archiv → backupUnreadable', async () => {
    const { archivePath, backupDir } = await freshArchive();
    truncateSync(archivePath, Math.floor(statSync(archivePath).size / 2));
    expect(await verifyBackupArchive(archivePath, { workDir: backupDir })).toMatchObject({ ok: false, reason: 'backupUnreadable' });
  });

  it('lässt keine Arbeitsdatei liegen', async () => {
    const { archivePath, backupDir } = await freshArchive();
    await verifyBackupArchive(archivePath, { workDir: backupDir });
    const broken = await craftTar([{ name: DB, data: Buffer.from('kaputt'.repeat(300)) }]);
    await verifyBackupArchive(broken, { workDir: backupDir });
    expect(readdirSync(backupDir).filter((n) => n.startsWith(BACKUP_WORK_PREFIX))).toEqual([]);
  });
});
