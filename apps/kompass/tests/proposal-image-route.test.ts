import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ value: null as unknown }));
const service = vi.hoisted(() => ({ result: null as unknown, calls: [] as unknown[][] }));
vi.mock('@/lib/request-context', () => ({ optionalSession: async () => session.value }));
vi.mock('@/lib/deps', () => ({ getDeps: () => ({}) }));
vi.mock('@kompass/module-animals', () => ({ readProposalImage: async (...args: unknown[]) => (service.calls.push(args), service.result) }));
const get = async (id: string, query = '') =>
  (await import('@/app/animals/proposal-images/[id]/route')).GET(new Request(`http://x/animals/proposal-images/${id}${query}`), { params: Promise.resolve({ id }) });

describe('proposal image route', () => {
  beforeEach(() => {
    session.value = { ctx: { userId: 'u' } };
    service.calls = [];
  });

  it('answers 401 without a session and never asks the service', async () => {
    session.value = null;
    expect((await get('I1')).status).toBe(401);
    expect(service.calls).toHaveLength(0);
  });

  it('answers 403 without animals.manage and 404 for an unknown or cleared image', async () => {
    service.result = { ok: false, error: { type: 'forbidden', permission: 'animals.manage' } };
    expect((await get('I1')).status).toBe(403);
    service.result = { ok: false, error: { type: 'notFound', entity: 'animalProposalImage', id: 'I1' } };
    expect((await get('I1')).status).toBe(404);
  });

  it('serves the WebP preview by default, the original on request, private and sandboxed', async () => {
    service.result = { ok: true, value: { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/webp' } };
    const res = await get('I1');
    expect(service.calls[0]![2]).toEqual({ imageId: 'I1', variant: 'preview' });
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    await get('I1', '?variant=original');
    expect(service.calls[1]![2]).toEqual({ imageId: 'I1', variant: 'original' });
  });
});
