import { coreModule, dashboardOptionFields, type ModuleManifest } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { installedModules } from '@/modules';

/**
 * Kacheln beschriften sich über `dashboard.tiles.<modul>.<key>` (Spec 2026-09-17,
 * § 3). Die Schlüssel sind zur Laufzeit zusammengesetzt; `message-keys.test.ts`
 * sieht sie nicht. Dieser Wächter leitet sie aus den Manifesten ab: Titel,
 * Leer-Satz, bei `warningAction` der Knopftext, je Option Label (und je
 * enum-Wert ein Text), je `messageKey` ein Eintrag. Einen Linktext „Zu …“ gibt
 * es seit 0.2.12 nicht mehr (Briefing Startseite § 4): Die Blätter je Kachel
 * stehen genau so da, nichts darüber hinaus.
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
      keys.push(`${ns}.title`, `${ns}.empty`);
      // Der Knopf einer Warnung nennt ein Verb (Briefing Startseite § 4, „Knöpfe“).
      if (tile.warningAction) keys.push(`${ns}.action`);
      for (const field of dashboardOptionFields(tile.options)) {
        keys.push(`${ns}.options.${field.name}.label`);
        if (field.type === 'enum') for (const value of field.values) keys.push(`${ns}.options.${field.name}.values.${value}`);
      }
      for (const key of tile.messageKeys ?? []) keys.push(`${ns}.messages.${key}`);
    }
  }
  return keys;
}

/** Alle Blätter unter `dashboard.tiles` als Punktpfade. */
function leaves(node: unknown, prefix: string): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, `${prefix}.${key}`));
}

describe('dashboard tile messages', () => {
  it('hat für jede Kachel Titel, Leer-Satz, Optionen und Meldungen', () => {
    const missing = expectedKeys().filter((key) => !resolves(key));
    expect(missing).toEqual([]);
  });

  it('hat je Kachel genau diese Blätter — kein „…open“ mehr, kein Knopftext ohne `warningAction`', () => {
    const expected = new Set(expectedKeys());
    const extra = leaves((messages as { dashboard: { tiles: unknown } }).dashboard.tiles, 'dashboard.tiles').filter((key) => !expected.has(key));
    expect(extra).toEqual([]);
  });

  it('kennt mindestens die Kacheln von Kern, Akte und Webseite und die Knöpfe der Warnungen', () => {
    expect(expectedKeys()).toEqual(
      expect.arrayContaining([
        'dashboard.tiles.core.followUps.title', 'dashboard.tiles.dms.inbox.title', 'dashboard.tiles.site.site.title',
        'dashboard.tiles.core.backup.action', 'dashboard.tiles.finance.setupIncomplete.action', 'dashboard.tiles.finance.lastStatement.action', 'dashboard.tiles.finance.reserveCapNear.action',
        'dashboard.tiles.site.site.action', 'dashboard.tiles.finance.balanceDifference.action', 'dashboard.tiles.finance.nobodyCanApprove.action',
        'dashboard.tiles.finance.purposesNegative.action', 'dashboard.tiles.finance.partnerPaymentsWithoutProof.action',
      ]),
    );
  });
});

describe('Silbentrennung in Kacheltiteln', () => {
  it('„Übersetzungslücken“ trennt mit weichem Trennzeichen (Befund 4, Designer 2026-10-17): sonst ragt das Wort am Telefon aus der halben Kachel', () => {
    const title = messages.dashboard.tiles.core.translations.title;
    expect(title).toBe('Übersetzungs­lücken');
    // Ohne das Zeichen ist es das gewohnte Wort — Suche und Vorleser sehen es so.
    expect(title.replace(/­/g, '')).toBe('Übersetzungslücken');
  });
});
