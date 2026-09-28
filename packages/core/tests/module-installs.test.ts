import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeps } from '../src/app';
import { coreModule } from '../src/core-module';
import { moduleProvisionErrors, settings } from '../src/db/schema';
import { defineModule, type ModuleManifest } from '../src/modules/manifest';
import { installOrder, listOpenInstallErrors, runModuleInstalls } from '../src/modules/installs';
import { createTestDeps, TEST_NOW } from '../src/testing';

const mod = (key: string, extra: Partial<ModuleManifest> = {}) => defineModule({ key, version: '0.0.0', permissions: [], ...extra });
const enable = (deps: ReturnType<typeof createTestDeps>, keys: string[]) =>
  deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(keys), updatedAt: TEST_NOW }).run();

describe('installOrder', () => {
  it('puts dependencies first, whatever the list order', () => {
    const order = installOrder([mod('c', { dependsOn: ['b'] }), mod('b', { dependsOn: ['a'] }), mod('a')]).map((m) => m.key);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('runModuleInstalls', () => {
  it('runs install of enabled modules only, in dependency order, with a system context', () => {
    const seen: string[] = [];
    const a = mod('a', { install: (_tx, _deps, ctx) => void seen.push(`a:${ctx.channel}`) });
    const b = mod('b', { dependsOn: ['a'], install: () => void seen.push('b') });
    const off = mod('off', { install: () => void seen.push('off') });
    const deps = createTestDeps({ manifests: [coreModule, b, off, a] });
    enable(deps, ['a', 'b']);
    runModuleInstalls(deps);
    expect(seen).toEqual(['a:system', 'b']);
  });

  it('catches a failing install, keeps going, and resolves the error on the next clean run', () => {
    let broken = true;
    const bad = mod('bad', { install: () => { if (broken) throw new Error('kaputt'); } });
    const good = mod('good', { install: () => undefined });
    const deps = createTestDeps({ manifests: [coreModule, bad, good] });
    enable(deps, ['bad', 'good']);
    expect(() => runModuleInstalls(deps)).not.toThrow();
    expect(listOpenInstallErrors(deps)).toEqual([{ module: 'bad', message: 'kaputt', at: TEST_NOW }]);
    broken = false;
    runModuleInstalls(deps);
    expect(listOpenInstallErrors(deps)).toEqual([]);
    expect(deps.db.select().from(moduleProvisionErrors).all()).toHaveLength(1); // nichts gelöscht
  });

  it('rolls back what a failing install wrote', () => {
    const bad = mod('bad', {
      install: (tx) => {
        tx.insert(settings).values({ key: 'probe.written', value: '1', updatedAt: TEST_NOW }).run();
        throw new Error('kaputt');
      },
    });
    const deps = createTestDeps({ manifests: [coreModule, bad] });
    enable(deps, ['bad']);
    runModuleInstalls(deps);
    expect(deps.db.select().from(settings).all().some((s) => s.key === 'probe.written')).toBe(false);
  });
});

describe('createDeps', () => {
  const dir = () => mkdtempSync(path.join(os.tmpdir(), 'kompass-installs-'));

  it('runs the installs on open and on reopen, unless told not to', () => {
    let calls = 0;
    const m = mod('m', { install: () => void (calls += 1) });
    const dataPath = dir();
    const first = createDeps({ dataPath, env: 'test', modules: [m], runInstalls: false });
    first.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['m']), updatedAt: TEST_NOW }).run();
    expect(calls).toBe(0);
    first.close();
    const second = createDeps({ dataPath, env: 'test', modules: [m] });
    expect(calls).toBe(1);
    second.reopen();
    expect(calls).toBe(2);
    second.close();
  });
});
