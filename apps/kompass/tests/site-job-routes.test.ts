import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ value: null as unknown }));
const service = vi.hoisted(() => ({ result: null as unknown, pending: { ok: false, error: { type: 'forbidden', permission: 'site.publish' } } as unknown, calls: [] as unknown[][] }));

vi.mock('@/lib/request-context', () => ({ optionalSession: async () => session.value }));
vi.mock('@/lib/deps', () => ({ getDeps: () => ({}) }));
vi.mock('@/lib/site-env', () => ({ siteEnv: () => ({}) }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@kompass/module-site', () => {
  const record = (name: string) => async (...args: unknown[]) => {
    service.calls.push([name, ...args]);
    return service.result;
  };
  return { SITE_JOB_KINDS: ['preview', 'publish', 'deployCheck'], siteJobOverview: (...args: unknown[]) => (service.calls.push(['overview', ...args]), service.result), siteJobResult: (...args: unknown[]) => (service.calls.push(['result', ...args]), service.result), getPublish: record('publish'), sitePendingChanges: async (...args: unknown[]) => (service.calls.push(['pending', ...args]), service.pending) };
});

const overview = async () => (await import('@/app/site/job/route')).GET();
const detail = async (kind: string, query = '') => (await import('@/app/site/job/[kind]/route')).GET(new Request(`http://x/site/job/${kind}${query}`), { params: Promise.resolve({ kind }) });
const publish = async (id: string, query = '') => (await import('@/app/site/publishes/[id]/route')).GET(new Request(`http://x/site/publishes/${id}${query}`), { params: Promise.resolve({ id }) });

describe('site job routes', () => {
  beforeEach(() => {
    session.value = { ctx: { userId: 'u' } };
    service.calls = [];
  });

  it('answer 401 without a session and never ask the service', async () => {
    session.value = null;
    expect((await overview()).status).toBe(401);
    expect((await detail('preview')).status).toBe(401);
    expect((await publish('P1')).status).toBe(401);
    expect(service.calls).toHaveLength(0);
  });

  it('answer 403 for forbidden and 404 for an unknown kind or publish', async () => {
    service.result = { ok: false, error: { type: 'forbidden', permission: 'site.publish' } };
    expect((await overview()).status).toBe(403);
    service.result = { ok: false, error: { type: 'validation', issues: [] } };
    expect((await detail('deploy')).status).toBe(404);
    service.result = { ok: false, error: { type: 'notFound', entity: 'sitePublish', id: 'X' } };
    expect((await publish('X')).status).toBe(404);
  });

  it('hand the error of a last run over as code and message, without caching', async () => {
    service.result = {
      ok: true,
      value: { running: null, last: { preview: { kind: 'preview', status: 'failed', error: { type: 'conflict', code: 'previewFailed', message: 'x' } }, publish: null, deployCheck: null } },
    };
    const res = await overview();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { last: { preview: { error: { code: string; message: string } } } };
    expect(body.last.preview.error).toMatchObject({ code: 'previewFailed' });
    expect(typeof body.last.preview.error.message).toBe('string');
  });

  it('adds what is not yet published: five names, all addresses, the count (Plan C)', async () => {
    service.result = { ok: true, value: { running: null, last: { preview: null, publish: null, deployCheck: null } } };
    const items = [
      ...Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, kind: 'changed', label: `Hund ${i}`, href: `/animals/${i}`, recordHref: `/animals/${i}` })),
      // Hinter den ersten fünf: Die Namen der Variablen kommen trotzdem alle mit (Designer 2026-10-10).
      { key: 'variables.phone', kind: 'changed', label: 'Telefon', href: '/site/variables', recordHref: '/site/variables' },
    ];
    service.pending = { ok: true, value: { since: '2026-09-28T08:00:00.000Z', count: 7, items, truncated: false } };
    const body = await (await overview()).json();
    expect(body.pending).toMatchObject({ since: '2026-09-28T08:00:00.000Z', count: 7 });
    expect(body.pending.items).toHaveLength(5);
    expect(body.pending.hrefs).toHaveLength(7);
    expect(body.pending.variables).toEqual(['Telefon']);
    service.pending = { ok: false, error: { type: 'forbidden', permission: 'site.publish' } };
    expect((await (await overview()).json()).pending).toBeNull();
  });

  it('pass paths=all and log=full on, and ignore other values', async () => {
    service.result = { ok: true, value: { running: null, last: null } };
    await detail('preview', '?paths=all&log=full');
    expect(service.calls.at(-1)?.[4]).toEqual({ kind: 'preview', paths: 'all', log: 'full' });
    await detail('preview', '?paths=x');
    expect(service.calls.at(-1)?.[4]).toEqual({ kind: 'preview' });
    service.result = { ok: true, value: { id: 'P1' } };
    await publish('P1', '?log=full');
    expect(service.calls.at(-1)?.[3]).toEqual({ id: 'P1', log: 'full' });
  });
});
