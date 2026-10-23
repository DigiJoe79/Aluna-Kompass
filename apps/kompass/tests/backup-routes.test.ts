import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeps, schema, type AppDeps } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ session: null as unknown, deps: null as unknown }));

vi.mock('next-intl/server', async () => {
  const messages = (await import('../messages/de.json')).default;
  return { getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) };
});
vi.mock('@/lib/request-context', () => ({ optionalSession: async () => state.session }));
vi.mock('@/lib/deps', () => ({ getDeps: () => state.deps, runtimeEnv: () => ({ backupPath: (state.deps as AppDeps).backupPath }) }));

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-routes-'));
  dirs.push(d);
  return d;
};

let deps: AppDeps;
beforeEach(() => {
  deps = createDeps({ dataPath: tmp(), backupPath: tmp(), env: 'test' });
  state.deps = deps;
  state.session = { ctx: ctxWith(['backup.export']) };
});
afterEach(() => {
  deps.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const download = async (name: string, headers: Record<string, string> = {}) =>
  (await import('@/app/admin/backup/files/[name]/route')).GET(new Request(`http://x/admin/backup/files/${encodeURIComponent(name)}`, { headers }), { params: Promise.resolve({ name }) });
const jobStatus = async () => (await import('@/app/admin/backup/job/route')).GET();
const actions = () => deps.db.select().from(schema.auditLog).all().map((e) => e.action);

function fakeArchive(name: string, size = 1000): Buffer {
  const bytes = Buffer.from(Array.from({ length: size }, (_, i) => i % 251));
  writeFileSync(path.join(deps.backupPath!, `${name}.tar`), bytes);
  return bytes;
}

describe('Backup-Download', () => {
  it('liefert die ganze Datei mit Länge und Dateinamen', async () => {
    const bytes = fakeArchive('b1');
    const res = await download('b1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('1000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('application/x-tar');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="b1.tar"');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    expect(actions()).toContain('backup.download');
  });

  it('setzt fort mit Range: 206 und Content-Range; jenseits des Endes 416', async () => {
    const bytes = fakeArchive('b1');
    const res = await download('b1', { range: 'bytes=500-' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 500-999/1000');
    expect(res.headers.get('content-length')).toBe('500');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(500))).toBe(true);
    expect(actions().filter((a) => a === 'backup.download')).toHaveLength(0);
    const beyond = await download('b1', { range: 'bytes=99999999-' });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe('bytes */1000');
  });

  it('401 ohne Sitzung, 403 ohne Recht, 404 für ../x und unbekannte', async () => {
    fakeArchive('b1');
    state.session = null;
    expect((await download('b1')).status).toBe(401);
    state.session = { ctx: ctxWith([]) };
    expect((await download('b1')).status).toBe(403);
    state.session = { ctx: ctxWith(['backup.export']) };
    expect((await download('../x')).status).toBe(404);
    expect((await download('fehlt')).status).toBe(404);
  });
});

describe('Backup-Zustand', () => {
  it('liefert running und last je Art, ohne Cache', async () => {
    const res = await jobStatus();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ running: null, last: { create: null, verify: null, restore: null } });
    state.session = null;
    expect((await jobStatus()).status).toBe(401);
    state.session = { ctx: ctxWith([]) };
    expect((await jobStatus()).status).toBe(403);
  });
});
