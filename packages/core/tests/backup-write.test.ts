import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import tarStream from 'tar-stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps, type AppDeps } from '../src/app';
import { login } from '../src/auth/login';
import { BACKUP_WORK_PREFIX } from '../src/backup/paths';
import { backupSourceOf, createBackupArchive } from '../src/backup/write';
import { users } from '../src/db/schema';
import { storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { seedDevelopment } from '../src/seed/seed';
import { ctxWith } from '../src/testing';

// 1×1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-write-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function listTarEntries(archivePath: string): Promise<{ name: string; size: number }[]> {
  const entries: { name: string; size: number }[] = [];
  const extract = tarStream.extract();
  extract.on('entry', (header, stream, next) => {
    let size = 0;
    stream.on('data', (chunk: unknown) => (size += (chunk as Buffer).length));
    stream.on('end', () => {
      entries.push({ name: header.name, size });
      next();
    });
    stream.resume();
  });
  await pipeline(createReadStream(archivePath), extract);
  return entries;
}

async function setup(): Promise<{ deps: AppDeps; backupDir: string }> {
  const root = tmp();
  const backupDir = path.join(root, 'backups');
  const deps = createDeps({ dataPath: path.join(root, 'data'), backupPath: backupDir, env: 'test', appVersion: '9.9.9' });
  const seed = await seedDevelopment(deps);
  unwrap(await login(deps, { email: seed.adminEmail, password: seed.adminPassword, ipAddress: null, requestId: 'R' }));
  const admin = deps.db.select().from(users).all()[0]!;
  unwrap(await storeMediaAsset(deps, ctxWith(['media.upload'], admin.id), { originalName: 'bild.png', bytes: PNG }));
  // Eine leere Datei: Auch sie steht im Archiv, mit Größe 0.
  writeFileSync(path.join(deps.dataPath, 'core', 'leer.txt'), '');
  return { deps, backupDir };
}

describe('writeBackupArchive', { timeout: 20_000 }, () => {
  it('schreibt tar ohne gzip mit Manifest am Ende, Datenbank ohne Sitzungen und Tokens', async () => {
    const { deps, backupDir } = await setup();
    const archivePath = path.join(backupDir, 'eins.tar');
    const out = await createBackupArchive(backupSourceOf(deps), { archivePath, workDir: backupDir, createdAt: deps.clock.now().toISOString() });
    const head = readFileSync(archivePath).subarray(0, 2);
    expect([head[0], head[1]]).not.toEqual([0x1f, 0x8b]);
    expect(out.manifest).toMatchObject({ format: 3, appVersion: '9.9.9', environment: 'test', migrationCount: deps.migrationCount, counts: { users: 4 } });
    expect(out.manifest.counts.mediaAssets).toBeGreaterThanOrEqual(1);
    expect(out.manifest.files.find((f) => f.path === 'data/core/db/kompass.db')!.size).toBeGreaterThan(0);
    expect(out.manifest.files.some((f) => f.path.startsWith('data/core/media/'))).toBe(true);
    expect(out.manifest.files).toContainEqual({ path: 'data/core/leer.txt', size: 0 });
    expect(out.sha256).toBe(createHash('sha256').update(readFileSync(archivePath)).digest('hex'));
    expect(out.sizeBytes).toBe(statSync(archivePath).size);

    const entries = await listTarEntries(archivePath);
    const names = entries.map((e) => e.name);
    expect(names.at(-1)).toBe('manifest.json');
    expect(names.some((n) => n.includes('.before-import-'))).toBe(false);
    expect(names.some((n) => /\.db-(wal|shm)$/.test(n))).toBe(false);
    // Das Manifest beschreibt genau das Geschriebene.
    expect(entries.filter((e) => e.name !== 'manifest.json')).toEqual(out.manifest.files.map((f) => ({ name: f.path, size: f.size })));

    const unpacked = tmp();
    await tar.extract({ file: archivePath, cwd: unpacked });
    const copy = new Database(path.join(unpacked, 'data', 'core', 'db', 'kompass.db'), { readonly: true });
    expect((copy.prepare('select count(*) as n from sessions').get() as { n: number }).n).toBe(0);
    expect((copy.prepare('select count(*) as n from api_tokens').get() as { n: number }).n).toBe(0);
    expect((copy.prepare('select count(*) as n from users').get() as { n: number }).n).toBe(4);
    copy.close();
    expect(readdirSync(backupDir).filter((n) => n.startsWith(BACKUP_WORK_PREFIX))).toEqual([]);
    deps.close();
  });

  it('beschreibt im Manifest genau das Geschriebene, wenn eine Datei nach der Liste verschwindet', async () => {
    const { deps, backupDir } = await setup();
    const mediaDir = path.join(deps.dataPath, 'core', 'media');
    const media = readdirSync(mediaDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    const victim = path.join(media[0]!.parentPath, media[0]!.name);
    const victimRel = 'data/' + path.relative(deps.dataPath, victim).split(path.sep).join('/');
    const archivePath = path.join(backupDir, 'zwei.tar');
    let first = true;
    const source = backupSourceOf(deps);
    const out = await createBackupArchive(source, {
      archivePath,
      workDir: backupDir,
      createdAt: deps.clock.now().toISOString(),
      onProgress: () => {
        if (first) unlinkSync(victim);
        first = false;
      },
    });
    expect(out.manifest.files.some((f) => f.path === victimRel)).toBe(false);
    const entries = await listTarEntries(archivePath);
    expect(entries.filter((e) => e.name !== 'manifest.json')).toEqual(out.manifest.files.map((f) => ({ name: f.path, size: f.size })));
    deps.close();
  });

  it('bricht über das Signal ab und hinterlässt kein Archiv', async () => {
    const { deps, backupDir } = await setup();
    const archivePath = path.join(backupDir, 'drei.tar');
    const controller = new AbortController();
    await expect(
      createBackupArchive(backupSourceOf(deps), {
        archivePath,
        workDir: backupDir,
        createdAt: deps.clock.now().toISOString(),
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(existsSync(archivePath)).toBe(false);
    expect(readdirSync(backupDir)).toEqual([]);
    deps.close();
  });
});
