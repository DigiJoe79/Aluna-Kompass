import { describe, expect, it, vi } from 'vitest';

/**
 * Befundliste 0.2.0, N10: `createDeps` bricht beim Start ab, wenn eine
 * Dateiablage nicht beschreibbar ist (`packages/core/src/app.ts`,
 * `ensureWritableDir`). `/api/health` fängt das ab und meldet
 * `files: 'unwritable'` statt eines unbehandelten 500 — Betrieb liest das,
 * ohne im Log nach `EACCES` suchen zu müssen.
 */
describe('GET /api/health', () => {
  it('meldet files: unwritable statt eines unbehandelten Fehlers, wenn createDeps deshalb abbricht', async () => {
    vi.resetModules();
    vi.doMock('@/lib/deps', () => ({
      getDeps: () => {
        throw new Error('Datenverzeichnis nicht beschreibbar: /data/finance');
      },
      runtimeEnv: () => ({ env: 'test' }),
    }));
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ status: 'error', files: 'unwritable', message: 'Datenverzeichnis nicht beschreibbar: /data/finance' });
    vi.doUnmock('@/lib/deps');
  });

  it('meldet einen anderen Fehler ohne files: unwritable', async () => {
    vi.resetModules();
    vi.doMock('@/lib/deps', () => ({
      getDeps: () => {
        throw new Error('irgendein anderer Startfehler');
      },
      runtimeEnv: () => ({ env: 'test' }),
    }));
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).not.toHaveProperty('files');
    expect(body.message).toBe('irgendein anderer Startfehler');
    vi.doUnmock('@/lib/deps');
  });
});
