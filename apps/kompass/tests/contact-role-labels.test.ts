import { readFileSync } from 'node:fs';
import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Rollenschlüssel sind Code; ihre Beschriftung steht in de.json. Ohne diese
 * Prüfung erschienen „interested“, „partner“ und „authority“ in der
 * Kontaktliste, auf der Detailseite und im Aufbewahrungskasten — Befund 4
 * der Durchsicht vom 2026-09-12.
 */
const messages = JSON.parse(readFileSync(new URL('../messages/de.json', import.meta.url), 'utf8')) as {
  contacts: { roleNames?: Record<string, string> };
};
const registry = createRegistry([coreModule, ...installedModules]);
const registered = registry.manifests.flatMap((m) => (m.contactRoles ?? []).map((r) => r.key));

describe('contact role labels', () => {
  it('beschriftet jede Kontaktrolle, die ein Modul beisteuert', () => {
    const labels = messages.contacts.roleNames ?? {};
    expect(registered.filter((key) => typeof labels[key] !== 'string')).toEqual([]);
  });

  it('führt keine Beschriftung für eine Rolle, die kein Modul mehr kennt', () => {
    const labels = Object.keys(messages.contacts.roleNames ?? {});
    expect(labels.filter((key) => !registered.includes(key))).toEqual([]);
  });
});
