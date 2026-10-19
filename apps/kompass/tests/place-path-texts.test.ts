import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/**
 * Wegangaben folgen der Navigation ab der zweiten Ebene, immer mit dem Abschnitt vorn:
 * „Einrichtung → Finanzen → Kategorien“, „Verwaltung → Nutzer“ (Designer K10 Charge 3 § 12.4).
 * „System“ ist nur das Dach in der Leiste und wird nie genannt; „Einstellungen“ gibt es als
 * Name eines Bereichs oder einer Seite nicht mehr (§ 12.1, § 12.3).
 */
function texts(value: unknown, path: string): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => texts(v, `${path}.${k}`));
  return [];
}

const all = texts(messages, '');
const nav = messages.nav;
/** Einträge der Unternavigation je Abschnitt (`CORE_ADMIN`, `CORE_CONFIG` und `adminNavigation` der Module). */
const pages: Record<string, string[]> = {
  [nav.groups.admin]: [nav.users, nav.roles, nav.audit, nav.retention, nav.backup],
  [nav.groups.config]: [nav.settings, nav.locales, nav.themes, nav.modules, nav.documents, nav.finance.admin, nav.animals.admin, nav.site.admin, nav.dms.admin, nav.members.admin],
};

describe('Wegangaben in Hinweistexten', () => {
  it('nennen weder „Einstellungen“ noch „System“ als Ort', () => {
    const asPlace = /Einstellungen →|System →|(?:in|zu|unter) den Einstellungen\b|unter Einstellungen\b/i;
    expect(all.filter(({ text }) => asPlace.test(text)).map(({ path }) => path)).toEqual([]);
  });

  it('nennen nach dem Abschnitt eine Seite, die in diesem Abschnitt steht', () => {
    const wrong = all.flatMap(({ path, text }) =>
      [...text.matchAll(new RegExp(`(${Object.keys(pages).join('|')}) → `, 'g'))]
        .filter((m) => !pages[m[1]!]!.some((page) => text.startsWith(page, m.index! + m[0].length)))
        .map((m) => `${path}: ${text.slice(m.index!, m.index! + m[0].length + 20)}`),
    );
    expect(wrong).toEqual([]);
  });
});
