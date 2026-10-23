import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearMaintenance, writeMaintenance } from '@kompass/core/maintenance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Drei Routen laufen am Proxy vorbei (`proxy.ts`, Matcher): `/mcp` und die beiden Uploads. Während des Einspielens
 * antworten sie selbst mit 503, bevor sie die Datenbank anfassen (Spec Backup § Einspielen). Der MCP-Handler ist
 * zwischengespeichert — die Sperre in `getDeps` erreichte ihn nie (Prüfung 2026-10-23, Befund 1).
 */
const spies = vi.hoisted(() => ({ handler: vi.fn(), deps: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/mcp', () => ({ getMcpHandler: () => ({ fetch: spies.handler }) }));
vi.mock('@/lib/deps', () => ({ getDeps: spies.deps }));
vi.mock('@/lib/request-context', () => ({ optionalSession: spies.session }));

let bp: string;
const saved = process.env.BACKUP_PATH;
beforeEach(() => {
  bp = mkdtempSync(path.join(tmpdir(), 'kompass-bypass-'));
  process.env.BACKUP_PATH = bp;
  spies.handler.mockReset().mockResolvedValue(new Response('ok'));
  spies.deps.mockReset();
  spies.session.mockReset();
});
afterEach(() => {
  clearMaintenance(bp);
  rmSync(bp, { recursive: true, force: true });
  if (saved === undefined) delete process.env.BACKUP_PATH;
  else process.env.BACKUP_PATH = saved;
});

const mark = () => writeMaintenance(bp, { runId: 'R', since: 't', phase: 'replace', aside: null, backupName: 'b', backupCreatedAt: 't', contact: null });
const post = (url: string) => new Request(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });

describe('Routen am Proxy vorbei während des Einspielens', () => {
  it('/mcp antwortet mit 503 und einem JSON-RPC-Fehler, ohne den Handler zu fragen', async () => {
    mark();
    const { POST } = await import('@/app/mcp/route');
    const res = await POST(post('http://k/mcp'));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32000, message: expect.stringMatching(/restoring a backup/) } });
    expect(spies.handler).not.toHaveBeenCalled();
  });

  it('/mcp ohne Merker geht an den Handler', async () => {
    const { POST } = await import('@/app/mcp/route');
    expect(await (await POST(post('http://k/mcp'))).text()).toBe('ok');
    expect(spies.handler).toHaveBeenCalledOnce();
  });

  it('die Uploads antworten mit 503, ohne Sitzung und Datenbank', async () => {
    mark();
    const upload = await import('@/app/admin/backup/upload/route');
    const setup = await import('@/app/setup/import/upload/route');
    expect((await upload.POST(post('http://k/admin/backup/upload'))).status).toBe(503);
    expect((await setup.POST(post('http://k/setup/import/upload'))).status).toBe(503);
    expect(spies.session).not.toHaveBeenCalled();
    expect(spies.deps).not.toHaveBeenCalled();
  });
});
