import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps, type AppDeps } from '../src/app';
import { listBackups } from '../src/backup/sidecar';
import { receiveBackupUpload, receiveSetupBackupUpload } from '../src/backup/upload';
import { backupSourceOf, createBackupArchive } from '../src/backup/write';
import { BACKUP_MAX_UNPACKED_BYTES } from '../src/backup/archive';
import { fixedClock, isoNow } from '../src/clock';
import { users } from '../src/db/schema';
import { unwrap } from '../src/result';
import { seedDevelopment } from '../src/seed/seed';
import { auditEntry, ctxWith } from '../src/testing';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-upload-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;

/** Ein Archiv als Bytes, aus einem eigenen Bestand (mit oder ohne Nutzer). */
async function archiveBytes(seed: boolean): Promise<Buffer> {
  const deps = createDeps({ dataPath: tmp(), env: 'test', clock: fixedClock('2026-10-20T10:00:00.000Z') });
  if (seed) await seedDevelopment(deps);
  const work = tmp();
  const archivePath = path.join(work, 'backup.tar');
  await createBackupArchive(backupSourceOf(deps), { archivePath, workDir: work, createdAt: isoNow(deps.clock) });
  deps.close();
  return readFileSync(archivePath);
}

/** Der Körper als Strom in Stücken von 64 KB; `failAfter` bricht ihn nach so vielen Bytes ab. */
function streamOf(bytes: Uint8Array, failAfter?: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (failAfter !== undefined && offset >= failAfter) return controller.error(new Error('Verbindung abgebrochen'));
      if (offset >= bytes.length) return controller.close();
      const next = bytes.subarray(offset, offset + 64 * 1024);
      offset += next.length;
      controller.enqueue(next);
    },
  });
}

async function setup(seed = true) {
  const clock = fixedClock('2026-10-23T10:00:00.000Z');
  const deps = createDeps({ dataPath: tmp(), backupPath: tmp(), env: 'test', clock });
  if (seed) await seedDevelopment(deps);
  const admin = deps.db.select().from(users).all()[0];
  return { deps, clock, bp: deps.backupPath!, ctx: ctxWith(['backup.import'], admin?.id ?? null) };
}

const uploads = (deps: AppDeps) => listBackups(deps.backupPath!).filter((i) => i.kind === 'upload').map((i) => i.name);

describe('receiveBackupUpload', { timeout: 60_000 }, () => {
  it('legt ein gültiges Backup als Art upload ab, prüft es und räumt Hochgeladene nach 30 Tagen auf, das neueste bleibt', async () => {
    const archive = await archiveBytes(true);
    const { deps, clock, ctx } = await setup();
    const first = unwrap(await receiveBackupUpload(deps, ctx, { body: streamOf(archive), contentLength: archive.length }));
    expect(first).toMatchObject({ kind: 'upload', verification: { status: 'passed' }, manifest: { format: 3 }, sizeBytes: archive.length });
    clock.advance(1000);
    const second = unwrap(await receiveBackupUpload(deps, ctx, { body: streamOf(archive), contentLength: null }));
    expect(uploads(deps)).toEqual([second.name, first.name]);
    expect(JSON.parse(auditEntry(deps, 'backup.upload').params!)).toEqual({ sizeBytes: archive.length });
    clock.advance(31 * DAY);
    const third = unwrap(await receiveBackupUpload(deps, ctx, { body: streamOf(archive), contentLength: archive.length }));
    expect(uploads(deps)).toEqual([third.name]);
    deps.close();
  });

  it('ein Nicht-Backup wird abgelehnt und hinterlässt nichts', async () => {
    const archive = await archiveBytes(true);
    const { deps, ctx, bp } = await setup();
    const kept = unwrap(await receiveBackupUpload(deps, ctx, { body: streamOf(archive), contentLength: archive.length }));
    const before = readdirSync(bp).sort();
    const junk = Buffer.from('kein Backup, nur Text '.repeat(200));
    expect(await receiveBackupUpload(deps, ctx, { body: streamOf(junk), contentLength: junk.length })).toMatchObject({
      ok: false,
      error: { type: 'validation', issues: [{ path: 'archive', message: 'backupFormatUnsupported' }] },
    });
    expect(readdirSync(bp).sort()).toEqual(before);
    expect(uploads(deps)).toEqual([kept.name]);
    deps.close();
  });

  it('ein abgebrochener Strom hinterlässt nichts', async () => {
    const archive = await archiveBytes(true);
    const { deps, ctx, bp } = await setup();
    const before = readdirSync(bp).sort();
    await expect(receiveBackupUpload(deps, ctx, { body: streamOf(archive, 1024), contentLength: archive.length })).rejects.toThrow();
    expect(readdirSync(bp).sort()).toEqual(before);
    deps.close();
  });

  it('contentLength über BACKUP_MAX_UNPACKED_BYTES → backupTooLarge ohne zu lesen', async () => {
    const { deps, ctx, bp } = await setup(false);
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({ pull: () => void (pulled = true) }, { highWaterMark: 0 });
    expect(await receiveBackupUpload(deps, ctx, { body, contentLength: BACKUP_MAX_UNPACKED_BYTES + 1 })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'backupTooLarge' } });
    expect(pulled).toBe(false);
    expect(readdirSync(bp).filter((n) => !n.startsWith('.jobs'))).toEqual([]);
    deps.close();
  });

  it('ohne backup.import forbidden; Setup-Variante nur bei leerer Installation und nicht ohne Nutzer', async () => {
    const archive = await archiveBytes(true);
    const empty = await archiveBytes(false);
    const seeded = await setup();
    expect(await receiveBackupUpload(seeded.deps, ctxWith(['backup.export']), { body: streamOf(archive), contentLength: archive.length })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await receiveSetupBackupUpload(seeded.deps, { body: streamOf(archive), contentLength: archive.length })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'setupAlreadyDone' } });
    seeded.deps.close();

    const fresh = await setup(false);
    expect(await receiveSetupBackupUpload(fresh.deps, { body: streamOf(empty), contentLength: empty.length })).toMatchObject({
      ok: false,
      error: { type: 'validation', issues: [{ message: 'backupWithoutUsers' }] },
    });
    expect(uploads(fresh.deps)).toEqual([]);
    const sidecar = unwrap(await receiveSetupBackupUpload(fresh.deps, { body: streamOf(archive), contentLength: archive.length }));
    expect(sidecar).toMatchObject({ kind: 'upload', manifest: { counts: { users: 4 } } });
    expect(auditEntry(fresh.deps, 'backup.upload')).toMatchObject({ channel: 'system', userId: null });
    fresh.deps.close();
  });
});
