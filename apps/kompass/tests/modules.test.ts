import { readFileSync } from 'node:fs';
import { createRegistry, coreModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

describe('installed modules', () => {
  it('registers installed modules without clashes', () => {
    const registry = createRegistry([coreModule, ...installedModules]);
    expect(installedModules.map((m) => m.key)).toEqual(['site', 'animals', 'contacts', 'dms']);
    expect(registry.permissionKeys.has('animals.manage')).toBe(true);
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
   * Die Projekte liegen im Kern, nicht im abgelösten Webseiten-Modul; ohne
   * eigene Kernrechte wären sie mit ihm verschwunden.
   */
  it('keeps the project permissions in the core', () => {
    const registry = createRegistry([coreModule, ...installedModules]);
    expect(registry.permissionKeys.has('projects.view')).toBe(true);
    expect(registry.permissionKeys.has('projects.manage')).toBe(true);
    expect([...registry.permissionKeys].filter((k) => k.startsWith('website.'))).toEqual([]);
  });
});
