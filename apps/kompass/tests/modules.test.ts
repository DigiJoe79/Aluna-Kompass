import { readFileSync } from 'node:fs';
import { createRegistry, coreModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

describe('installed modules', () => {
  it('registers installed modules without clashes', () => {
    const registry = createRegistry([coreModule, ...installedModules]);
    expect(installedModules.map((m) => m.key)).toEqual(['site', 'projects', 'animals', 'contacts', 'dms']);
    expect(registry.permissionKeys.has('animals.manage')).toBe(true);
    expect(registry.permissionKeys.has('projects.manage')).toBe(true);
    expect(registry.permissionKeys.has('site.publish')).toBe(true);
    expect(registry.permissionKeys.has('contacts.manage')).toBe(true);
    expect(registry.permissionKeys.has('dms.view')).toBe(true);
    expect(registry.settingDefinitions.has('site.blockedTerms')).toBe(true);
  });

  it('gives every installed module a COPY line in the Dockerfile', () => {
    // Fehlt sie, laufen Tests und Typecheck grün durch und erst `pnpm image` bricht.
    const dockerfile = readFileSync(new URL('../../../Dockerfile', import.meta.url), 'utf8');
    const missing = installedModules
      .map((m) => m.key)
      .filter((key) => !dockerfile.includes(`COPY packages/modules/${key}/package.json`));
    expect(missing).toEqual([]);
  });

  /**
   * Die Projekte lagen bis zum 2026-09-12 im Kern; seither bringt das Modul
   * `projects` ihre Rechte mit, und der Kern kennt sie nicht mehr.
   */
  it('takes the project permissions from the projects module, not the core', () => {
    const registry = createRegistry([coreModule, ...installedModules]);
    expect(registry.permissionKeys.has('projects.view')).toBe(true);
    expect(registry.permissionKeys.has('projects.manage')).toBe(true);
    expect([...coreModule.permissions].filter((k) => k.startsWith('projects.'))).toEqual([]);
    expect([...registry.permissionKeys].filter((k) => k.startsWith('website.'))).toEqual([]);
  });
});
