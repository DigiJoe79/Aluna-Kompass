import { coreModule, dashboardOptionFields, type ModuleManifest } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { installedModules } from '@/modules';

/**
 * Kacheln beschriften sich über `dashboard.tiles.<modul>.<key>` (Spec 2026-09-17,
 * § 3). Die Schlüssel sind zur Laufzeit zusammengesetzt; `message-keys.test.ts`
 * sieht sie nicht. Dieser Wächter leitet sie aus den Manifesten ab: Titel,
 * Leer-Satz, Linktext, je Option Label (und je enum-Wert ein Text), je
 * `messageKey` ein Eintrag.
 */
function resolves(dotted: string): boolean {
  let node: unknown = messages;
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[part];
    if (node === undefined) return false;
  }
  return typeof node === 'string';
}

const manifests: ModuleManifest[] = [coreModule, ...installedModules];

function expectedKeys(): string[] {
  const keys: string[] = [];
  for (const m of manifests) {
    for (const tile of m.dashboardTiles ?? []) {
      const ns = `dashboard.tiles.${m.key}.${tile.key}`;
      keys.push(`${ns}.title`, `${ns}.empty`, `${ns}.open`);
      for (const field of dashboardOptionFields(tile.options)) {
        keys.push(`${ns}.options.${field.name}.label`);
        if (field.type === 'enum') for (const value of field.values) keys.push(`${ns}.options.${field.name}.values.${value}`);
      }
      for (const key of tile.messageKeys ?? []) keys.push(`${ns}.messages.${key}`);
    }
  }
  return keys;
}

describe('dashboard tile messages', () => {
  it('hat für jede Kachel Titel, Leer-Satz, Linktext, Optionen und Meldungen', () => {
    const missing = expectedKeys().filter((key) => !resolves(key));
    expect(missing).toEqual([]);
  });

  it('kennt mindestens die Kacheln von Kern, Akte und Webseite', () => {
    expect(expectedKeys()).toEqual(expect.arrayContaining(['dashboard.tiles.core.followUps.title', 'dashboard.tiles.dms.inbox.title', 'dashboard.tiles.site.site.title']));
  });
});
