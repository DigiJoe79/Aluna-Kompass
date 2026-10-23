import { coreModule, defineModule, sendSystemMail, systemMailAvailable, writeSettingInternal, type ModuleManifest, type SystemMailMessage } from '../src';
import { createTestDeps, systemContext } from '../src/testing';
import { describe, expect, it } from 'vitest';

const msg: SystemMailMessage = { to: 'a@example.org', subject: 's', text: 't' };

function withModules(manifests: ModuleManifest[], enabled: string[]) {
  const deps = createTestDeps({ manifests });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', enabled));
  return deps;
}

describe('Systemmail', () => {
  it('nimmt den ersten eingeschalteten Haken, der verfügbar ist', async () => {
    const sent: SystemMailMessage[] = [];
    const off = defineModule({ key: 'aus', version: '1', permissions: [], systemMail: { available: () => false, send: async () => { throw new Error('nie'); } } });
    const mod = defineModule({ key: 'm', version: '1', permissions: [], systemMail: { available: () => true, send: async (_d, m) => { sent.push(m); return { sent: true }; } } });
    const deps = withModules([coreModule, off, mod], ['aus', 'm']);
    expect(systemMailAvailable(deps)).toBe(true);
    expect(await sendSystemMail(deps, msg)).toEqual({ sent: true });
    expect(sent).toEqual([msg]);
  });

  it('ohne Haken oder mit ausgeschaltetem Modul: unavailable', async () => {
    expect(systemMailAvailable(createTestDeps())).toBe(false);
    expect(await sendSystemMail(createTestDeps(), msg)).toEqual({ sent: false, reason: 'unavailable' });
    const mod = defineModule({ key: 'm', version: '1', permissions: [], systemMail: { available: () => true, send: async () => ({ sent: true }) } });
    const deps = withModules([coreModule, mod], []);
    expect(systemMailAvailable(deps)).toBe(false);
    expect(await sendSystemMail(deps, msg)).toEqual({ sent: false, reason: 'unavailable' });
  });
});
