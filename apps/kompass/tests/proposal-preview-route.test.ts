import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ value: null as unknown }));
const root = vi.hoisted(() => ({ dir: '' }));
vi.mock('@/lib/request-context', () => ({ optionalSession: async () => session.value }));
vi.mock('@/lib/site-env', () => ({ siteEnv: () => ({ cacheDir: path.join(root.dir, 'site-build') }) }));
const get = async (key: string, parts: string[] = []) =>
  (await import('@/app/animals/proposal-preview/[key]/[[...path]]/route')).GET(new Request(`http://x/animals/proposal-preview/${key}/${parts.join('/')}`), { params: Promise.resolve({ key, path: parts }) });

describe('proposal preview route', () => {
  beforeEach(() => {
    root.dir = mkdtempSync(path.join(tmpdir(), 'kompass-pp-'));
    const out = path.join(root.dir, 'site-single', 'k1', 'out');
    mkdirSync(path.join(out, 'hunde', 'lotte'), { recursive: true });
    writeFileSync(path.join(out, 'hunde', 'lotte', 'index.html'), '<head><img src="/images/a.webp"></head>');
    session.value = { ctx: { userId: 'u', permissions: new Set(['animals.manage']) } };
  });

  it('answers 401 without a session and 403 without animals.manage', async () => {
    session.value = null;
    expect((await get('k1', ['hunde', 'lotte'])).status).toBe(401);
    session.value = { ctx: { userId: 'u', permissions: new Set(['animals.view']) } };
    expect((await get('k1', ['hunde', 'lotte'])).status).toBe(403);
  });

  it('serves the built page with its addresses under the preview prefix, never outside its folder', async () => {
    const res = await get('k1', ['hunde', 'lotte']);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('src="/animals/proposal-preview/k1/images/a.webp"');
    expect((await get('k1', ['..', '..', 'etc'])).status).toBe(404);
    expect((await get('../x', [])).status).toBe(404);
  });
});
