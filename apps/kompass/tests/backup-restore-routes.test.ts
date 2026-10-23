import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backupJobSlot, backupSourceOf, beginJob, createBackupArchive, createDeps, endJob, fixedClock, isoNow, writeMaintenance, type AppDeps } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ session: null as unknown, deps: null as unknown, optionalSession: vi.fn(), clearSessionCookie: vi.fn() }));

vi.mock('@/lib/request-context', () => ({ optionalSession: state.optionalSession, clearSessionCookie: state.clearSessionCookie }));
vi.mock('@/lib/deps', () => ({ getDeps: () => state.deps, runtimeEnv: () => ({ backupPath: (state.deps as AppDeps).backupPath }) }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-restore-routes-'));
  dirs.push(d);
  return d;
};

let deps: AppDeps;
beforeEach(() => {
  deps = createDeps({ dataPath: tmp(), backupPath: tmp(), env: 'test', clock: fixedClock('2026-10-23T10:00:00.000Z') });
  state.deps = deps;
  state.optionalSession.mockReset();
  state.optionalSession.mockImplementation(async () => state.session);
  state.clearSessionCookie.mockReset();
  state.session = { ctx: ctxWith(['backup.export', 'backup.import']) };
});
afterEach(() => {
  deps.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const upload = async (body: Buffer) => (await import('@/app/admin/backup/upload/route')).POST(new Request('http://x/admin/backup/upload', { method: 'POST', body: new Uint8Array(body), duplex: 'half' } as RequestInit));
const jobStatus = async (runId?: string) => (await import('@/app/admin/backup/job/route')).GET(new Request(`http://x/admin/backup/job${runId ? `?runId=${runId}` : ''}`));

async function archiveBytes(): Promise<Buffer> {
  const work = tmp();
  const archivePath = path.join(work, 'b.tar');
  await createBackupArchive(backupSourceOf(deps), { archivePath, workDir: work, createdAt: isoNow(deps.clock) });
  return readFileSync(archivePath);
}

describe('POST /admin/backup/upload', { timeout: 30_000 }, () => {
  it('401 ohne Sitzung, 403 ohne backup.import, 200 mit Archiv, 422 mit Unsinn', async () => {
    const bytes = await archiveBytes();
    state.session = null;
    expect((await upload(bytes)).status).toBe(401);
    state.session = { ctx: ctxWith(['backup.export']) };
    expect((await upload(bytes)).status).toBe(403);
    state.session = { ctx: ctxWith(['backup.import']) };
    const ok = await upload(bytes);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ name: expect.stringMatching(/-upload$/), manifest: { format: 3 }, verification: { status: 'passed' } });
    const junk = await upload(Buffer.from('kein Backup '.repeat(100)));
    expect(junk.status).toBe(422);
    expect(await junk.json()).toEqual({ error: 'backupFormatUnsupported' });
  });
});

describe('GET /admin/backup/job während der Wartung', () => {
  it('antwortet nur für den laufenden Lauf, ohne Sitzung und Datenbank; sonst 503', async () => {
    const slot = backupJobSlot(deps.backupPath!);
    const h = beginJob(slot, deps.clock, { kind: 'restore', steps: ['safeguard'], source: 'ui', userId: null, runId: 'R' });
    if ('busy' in h) throw new Error('busy');
    writeMaintenance(deps.backupPath!, { runId: 'R', since: 't', phase: 'replace', aside: null, backupName: 'b', backupCreatedAt: 't', contact: null });
    const res = await jobStatus('R');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ maintenance: true, running: { runId: 'R' } });
    expect((await jobStatus('X')).status).toBe(503);
    expect((await jobStatus()).status).toBe(503);
    expect(state.optionalSession).not.toHaveBeenCalled();
    endJob(slot, 'R');
  });
});
