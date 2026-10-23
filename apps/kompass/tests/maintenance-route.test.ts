import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({ session: vi.fn(), deps: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/request-context', () => ({ optionalSession: spies.session }));
vi.mock('@/lib/deps', () => ({ getDeps: spies.deps, runtimeEnv: () => ({ backupPath: '/bp' }) }));
vi.mock('@kompass/core', () => ({ maintenanceView: spies.view }));

describe('GET /maintenance/state', () => {
  beforeEach(() => {
    spies.session.mockReset();
    spies.deps.mockReset();
    spies.view.mockReset();
  });

  it('liefert den Zustand ohne Sitzung und ohne Datenbank, nie aus dem Cache', async () => {
    spies.view.mockReturnValue({ phase: 'running', runId: 'R', backupCreatedAt: 't', steps: [] });
    const res = await (await import('@/app/maintenance/state/route')).GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ phase: 'running', runId: 'R', backupCreatedAt: 't', steps: [] });
    expect(spies.view).toHaveBeenCalledWith('/bp', expect.any(Date));
    expect(spies.session).not.toHaveBeenCalled();
    expect(spies.deps).not.toHaveBeenCalled();
  });
});

vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

describe('Seite /maintenance', () => {
  beforeEach(() => {
    spies.session.mockReset();
    spies.deps.mockReset();
    spies.view.mockReset();
  });

  it('rendert ohne Sitzung und ohne Datenbank, leitet nur bei idle auf /', async () => {
    const page = (await import('@/app/maintenance/page')).default;
    spies.view.mockReturnValue({ phase: 'idle' });
    await expect(page()).rejects.toThrow('redirect /');
    spies.view.mockReturnValue({ phase: 'running', runId: 'R', backupCreatedAt: 't', startedAt: 't', startedBy: null, estimatedSeconds: null, timeZone: 'Europe/Berlin', organization: null, steps: [] });
    expect(await page()).toBeTruthy();
    expect(spies.session).not.toHaveBeenCalled();
    expect(spies.deps).not.toHaveBeenCalled();
  });
});
