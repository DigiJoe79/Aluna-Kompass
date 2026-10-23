import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { clearMaintenance, writeMaintenance } from '@kompass/core/maintenance';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config, proxy } from '@/proxy';

let bp: string;
const saved = process.env.BACKUP_PATH;
beforeEach(() => {
  bp = mkdtempSync(path.join(tmpdir(), 'kompass-proxy-'));
  process.env.BACKUP_PATH = bp;
});
afterEach(() => {
  rmSync(bp, { recursive: true, force: true });
  if (saved === undefined) delete process.env.BACKUP_PATH;
  else process.env.BACKUP_PATH = saved;
});

const req = (url: string, init: { method?: string; accept?: string; session?: boolean } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.accept ? { accept: init.accept } : {}), ...(init.session === false ? {} : { cookie: 'kompass_session=s' }) },
  });
const on = () => writeMaintenance(bp, { runId: 'R', since: 't', phase: 'replace', aside: null, backupName: 'b', backupCreatedAt: 't', contact: null });

describe('proxy: Anmeldung', () => {
  it('leitet ohne Sitzung auf /login um, ohne Suchteil', () => {
    clearMaintenance(bp);
    const res = proxy(req('/animals?x=1', { accept: 'text/html', session: false }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login');
  });

  it('lässt öffentliche Pfade, /api und die Wartungsseite ohne Sitzung durch', () => {
    clearMaintenance(bp);
    for (const url of ['/login', '/setup/import', '/__e2e/login', '/mcp', '/api/health', '/api/help/x', '/maintenance', '/maintenance/state']) {
      expect(proxy(req(url, { session: false })).headers.get('x-middleware-next'), url).toBe('1');
    }
  });

  it('zeigt während des Einspielens die Wartungsseite auch ohne Sitzung', () => {
    on();
    expect(proxy(req('/animals', { accept: 'text/html', session: false })).headers.get('x-middleware-rewrite')).toMatch(/\/maintenance$/);
  });
});

describe('proxy', () => {
  it('lässt ohne Merker alles durch', async () => {
    clearMaintenance(bp);
    const res = proxy(req('/animals', { accept: 'text/html' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('schreibt während des Einspielens Seitenanfragen auf /maintenance um', async () => {
    on();
    const res = proxy(req('/animals', { accept: 'text/html,application/xhtml+xml' }));
    expect(res.headers.get('x-middleware-rewrite')).toMatch(/\/maintenance$/);
  });

  it('antwortet allem anderen mit 503', async () => {
    on();
    const health = proxy(req('/api/health'));
    expect(health.status).toBe(503);
    expect(health.headers.get('retry-after')).toBe('30');
    expect(await health.json()).toEqual({ error: 'maintenance' });
    expect(proxy(req('/admin/users', { method: 'POST', accept: 'text/x-component' })).status).toBe(503);
    expect(proxy(req('/mcp', { method: 'POST', accept: 'application/json' })).status).toBe(503);
  });

  it('lässt Wartungsseite, ihren Zustand und die Zustandsabfrage des Laufs durch', async () => {
    on();
    for (const url of ['/maintenance', '/maintenance/state', '/admin/backup/job?runId=R']) {
      expect(proxy(req(url, { accept: 'text/html' })).headers.get('x-middleware-next'), url).toBe('1');
    }
  });

  it('nimmt statische Dateien aus dem Matcher', () => {
    expect(config.matcher[0]!.source).toContain('_next/static');
    expect(config.matcher[0]!.source).toContain('_next/image');
    expect(config.matcher[0]!.source).toContain('favicon.ico');
  });

  // Next puffert den Körper jeder Anfrage, die durch den Proxy läuft, und kürzt ihn bei 10 MB
  // (`proxyClientMaxBodySize`, am 2026-10-23 mit 15 MB an /setup/import/upload nachgestellt). Die Upload-Routen und
  // /mcp laufen deshalb nicht durch den Proxy; während des Einspielens hält sie `getDeps` auf. Keine Header-Bedingung
  // (`missing`): Next wertet den Matcher auch im Browser aus, dort ließ sie /projects endlos neu laden.
  it('lässt Upload-Routen und /mcp am Proxy vorbei, ohne Header-Bedingung', () => {
    const source = new RegExp(`^${config.matcher[0]!.source}$`);
    for (const p of ['/admin/backup/upload', '/setup/import/upload', '/mcp']) expect(source.test(p), p).toBe(false);
    for (const p of ['/projects', '/admin/backup', '/setup/import', '/api/health', '/maintenance']) expect(source.test(p), p).toBe(true);
    expect('missing' in config.matcher[0]!).toBe(false);
  });
});
