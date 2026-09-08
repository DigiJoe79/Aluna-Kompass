import { createRegistry, coreModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

describe('installed modules', () => {
  it('registers site and animals without clashes', () => {
    const registry = createRegistry([coreModule, ...installedModules]);
    expect(installedModules.map((m) => m.key)).toEqual(['site', 'animals']);
    expect(registry.permissionKeys.has('animals.manage')).toBe(true);
    expect(registry.permissionKeys.has('site.publish')).toBe(true);
    expect(registry.settingDefinitions.has('site.blockedTerms')).toBe(true);
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
