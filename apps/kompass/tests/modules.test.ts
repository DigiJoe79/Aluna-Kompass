import { readFileSync } from 'node:fs';
import { createRegistry, coreModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

describe('installed modules', () => {
  it('registers installed modules without clashes, each with permissions under its own key', () => {
    const registry = createRegistry([coreModule, ...installedModules]);
    expect(registry.permissionKeys.size).toBe([coreModule, ...installedModules].reduce((n, m) => n + m.permissions.length, 0));
    const foreign = installedModules.flatMap((m) => m.permissions.filter((key) => !key.startsWith(`${m.key}.`)).map((key) => `${m.key}: ${key}`));
    expect(foreign).toEqual([]);
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

/**
 * Unter Einrichtung → Module steht der Name aus der Sprachdatei; fehlt er,
 * zeigt die Karte den blossen Schlüssel an (`module-card.tsx`). So standen
 * dort bis zum 14.09. „site“, „contacts“ und „dms“ — und `names.website`
 * gehörte zu einem Modul, das längst `site` heisst. Der Fallback verschweigt
 * die Lücke, deshalb prüft der Test sie.
 */
describe('module names in the interface', () => {
  const messages = JSON.parse(readFileSync(new URL('../messages/de.json', import.meta.url), 'utf8')) as {
    modules: { names: Record<string, string>; descriptions: Record<string, string> };
  };
  const keys = [coreModule.key, ...installedModules.map((m) => m.key)];

  it('gives every installed module a German name', () => {
    expect(keys.filter((key) => !messages.modules.names[key])).toEqual([]);
  });

  it('gives every installed module a description', () => {
    expect(keys.filter((key) => !messages.modules.descriptions[key])).toEqual([]);
  });
});
