import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUPS } from '@/lib/navigation';

/**
 * Die schmale Navigationsleiste hat 52 px je Zeile und Platz für eine Zeile (Designer 2026-10-11 § 12): Ein Name
 * hat höchstens 11 Zeichen. Ein längerer Bereichsname bringt je Sprache einen Kurznamen `nav.navLabel.<key>` mit;
 * die Seite behält den vollen Namen. Ob ein Name in Pixeln passt, zeigt der Screenshot-Lauf, nicht dieser Test.
 */
const MAX = 11;
const dir = join(__dirname, '..', 'messages');
const locales = readdirSync(dir).filter((f) => f.endsWith('.json'));

interface Nav {
  home: string;
  settingsArea: string;
  groups: Record<string, string>;
  navLabel?: Record<string, string>;
}

/** Bereich in der Leiste → angezeigter Name. `core` hat keinen Bereich, Verwaltung und Einrichtung stehen unter „System“. */
function railLabels(nav: Nav): Record<string, string> {
  const entries: Record<string, string> = { home: nav.home, settings: nav.settingsArea };
  for (const [key, label] of Object.entries(nav.groups)) {
    if (key !== 'core' && !SETTINGS_GROUPS.has(key)) entries[key] = label;
  }
  for (const key of Object.keys(entries)) entries[key] = nav.navLabel?.[key] ?? entries[key]!;
  return entries;
}

describe.each(locales)('Namen der Navigationsleiste (%s)', (file) => {
  const nav = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { nav: Nav }).nav;

  it(`hat höchstens ${MAX} Zeichen je Eintrag`, () => {
    const tooLong = Object.entries(railLabels(nav)).filter(([, label]) => [...label].length > MAX);
    expect(tooLong).toEqual([]);
  });

  it('nennt Kurznamen nur für Bereiche, die es in der Leiste gibt', () => {
    const known = Object.keys(railLabels({ ...nav, navLabel: undefined }));
    expect(Object.keys(nav.navLabel ?? {}).filter((key) => !known.includes(key))).toEqual([]);
  });
});

describe('Kurzname in der Leiste', () => {
  it('ersetzt nur einen zu langen Namen', () => {
    const nav: Nav = { home: 'Startseite', settingsArea: 'System', groups: { finance: 'Finanzbuchhaltung' }, navLabel: { finance: 'Finanzen' } };
    expect(railLabels(nav)).toEqual({ home: 'Startseite', settings: 'System', finance: 'Finanzen' });
  });
});
