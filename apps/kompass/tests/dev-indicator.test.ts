import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * K9-Befund 14: Der Routen-Indikator von `next dev` sitzt unten rechts und fängt dort Mausklicks ab — in den
 * E2E-Läufen gegen `next dev` zuletzt das Zeilenmenü der Rücklagen. `e2e/servers.ts` verlangt ihn deshalb per
 * Umgebungsvariable weg; im normalen `pnpm dev` bleibt er, wo er seit 14.09. steht.
 */
async function loadConfig() {
  vi.resetModules();
  return (await import('../next.config')).default;
}

describe('next.config devIndicators', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bleibt im normalen Entwicklungsbetrieb unten rechts', async () => {
    vi.stubEnv('KOMPASS_E2E_NO_DEV_INDICATOR', '');
    expect((await loadConfig()).devIndicators).toEqual({ position: 'bottom-right' });
  });

  it('ist aus, wenn die E2E-Server es verlangen', async () => {
    vi.stubEnv('KOMPASS_E2E_NO_DEV_INDICATOR', '1');
    expect((await loadConfig()).devIndicators).toBe(false);
  });
});
