import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backupJobSlot, backupJobStatus, createDeps, schema, seedDevelopment, startBackup, unwrap, waitForJob, writeJsonAtomic, type AppDeps, type JobRecord, type RestoreResult } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { backupJobView } from '@/lib/backup-job-view';
import messages from '../messages/de.json';

const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as Parameters<typeof backupJobView>[2];
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-job-view-'));
  dirs.push(d);
  return d;
};
let deps: AppDeps;
afterEach(() => {
  deps?.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  deps = createDeps({ dataPath: tmp(), backupPath: tmp(), env: 'test' });
  await seedDevelopment(deps);
  const admin = deps.db.select().from(schema.users).all()[0]!;
  return { admin, ctx: ctxWith(['backup.export', 'backup.import'], admin.id) };
}

describe('backupJobView', { timeout: 30_000 }, () => {
  it('nennt Person und verstrichene Zeit des laufenden Laufs und kürzt Ergebnisse auf den Namen', async () => {
    const { admin, ctx } = await setup();
    const started = unwrap(await startBackup(deps, ctx, {}));
    if (!started.started) throw new Error('busy');
    const status = unwrap(await backupJobStatus(deps, ctx, {}));
    const view = backupJobView(deps, status, t, new Date(Date.parse(status.running!.startedAt) + 5000));
    expect(view.running).toMatchObject({ runId: started.runId, kind: 'create', userName: admin.name, elapsedMs: 5000, source: 'ui' });
    await waitForJob(backupJobSlot(deps.backupPath!), started.runId);
    const after = backupJobView(deps, unwrap(await backupJobStatus(deps, ctx, {})), t, new Date());
    expect(after.running).toBeNull();
    expect(after.last.create).toMatchObject({ status: 'success', name: expect.stringMatching(/manual$/) });
    expect(after.last.verify).toBeNull();
    expect(JSON.stringify(after).includes('"files"')).toBe(false);
    expect(JSON.stringify(after).includes('"result"')).toBe(false);
  });

  it('liefert bei restore publishedSinceBackup und backupCreatedAt aus dem Ergebnis, Fehler übersetzt', async () => {
    const { ctx } = await setup();
    const slot = backupJobSlot(deps.backupPath!);
    mkdirSync(slot.dir, { recursive: true });
    const result: RestoreResult = { name: 'b1', backupCreatedAt: '2026-10-22T01:00:00.000Z', lastPublishedAt: '2026-10-22T09:00:00.000Z', publishedSinceBackup: true };
    const record: JobRecord<RestoreResult> = { kind: 'restore', runId: 'restore-1', startedAt: '2026-10-23T08:00:00.000Z', finishedAt: '2026-10-23T08:05:00.000Z', userId: ctx.userId, status: 'success', steps: [], meta: { name: 'b1' }, result };
    writeJsonAtomic(path.join(slot.dir, 'restore-result.json'), record);
    writeJsonAtomic(path.join(slot.dir, 'verify-result.json'), {
      ...record,
      kind: 'verify',
      runId: 'v1',
      status: 'failed',
      lastStep: 'verify',
      result: undefined,
      error: { type: 'conflict', code: 'jobInterrupted', message: 'jobInterrupted', messageKey: 'jobs.errors.jobInterrupted', params: {} },
    });
    const view = backupJobView(deps, unwrap(await backupJobStatus(deps, ctx, {})), t, new Date());
    expect(view.last.restore).toMatchObject({ name: 'b1', restore: { backupCreatedAt: result.backupCreatedAt, publishedSinceBackup: true } });
    expect(view.last.verify).toMatchObject({ status: 'failed', name: 'b1', lastStep: 'verify', error: { code: 'jobInterrupted' } });
    expect(view.last.verify?.error?.message).toContain(messages.jobs.errors.jobInterrupted.reason);
  });
});
