import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ value: null as unknown }));
const service = vi.hoisted(() => ({ result: null as unknown, calls: [] as unknown[][] }));

vi.mock('@/lib/request-context', () => ({ optionalSession: async () => session.value }));
vi.mock('@/lib/deps', () => ({ getDeps: () => ({}) }));
vi.mock('@kompass/core', () => ({ isModuleEnabled: () => true }));
vi.mock('@kompass/module-dms', () => ({
  getDocumentTextStatus: async (...args: unknown[]) => {
    service.calls.push(args);
    return service.result;
  },
}));

const call = async (id = 'D1') => {
  const { GET } = await import('@/app/dms/[id]/text-status/route');
  return GET(new Request('http://x/dms/D1/text-status'), { params: Promise.resolve({ id }) });
};

describe('GET /dms/[id]/text-status', () => {
  beforeEach(() => {
    session.value = { ctx: { userId: 'u' } };
    service.calls = [];
  });

  it('liefert den Stand für ein lesbares Dokument, ohne Zwischenspeicher', async () => {
    service.result = { ok: true, value: { textStatus: 'running' } };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ textStatus: 'running' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(service.calls[0]?.[2]).toBe('D1');
  });

  it('verweigert ohne Sitzung, ohne den Dienst zu fragen', async () => {
    session.value = null;
    expect((await call()).status).toBe(401);
    expect(service.calls).toHaveLength(0);
  });

  it('verweigert, was die Seite auch verweigert, ohne Daten mitzuschicken', async () => {
    service.result = { ok: false, error: { type: 'forbidden', permission: 'dms.view' } };
    const forbidden = await call();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).toBe('');
    service.result = { ok: false, error: { type: 'notFound', entity: 'document', id: 'X' } };
    expect((await call('X')).status).toBe(404);
  });
});
