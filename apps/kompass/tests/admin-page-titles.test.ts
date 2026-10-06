import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/**
 * Die Überschrift einer Einstellungsseite nennt den Namen der Rubrik, unter dem
 * die Navigation sie führt; die Beschreibung darunter sagt, was dort geschieht.
 * Abweichungen stehen mit Grund in `ALLOWED` (noch offen: Befund 2 der Abnahme
 * 0.2.6, Entscheidung Joe).
 */
const m = messages as unknown as Record<string, any>;

// Rubrik in der Navigation → Namensraum der Seite mit `title`.
const PAGES: Record<string, { nav: string; page: string }> = {
  users: { nav: m.nav.users, page: m.users.title },
  roles: { nav: m.nav.roles, page: m.roles.title },
  audit: { nav: m.nav.audit, page: m.audit.title },
  retention: { nav: m.nav.retention, page: m.retention.title },
  backup: { nav: m.nav.backup, page: m.backup.title },
  settings: { nav: m.nav.settings, page: m.settings.title },
  locales: { nav: m.nav.locales, page: m.admin.locales.title },
  themes: { nav: m.nav.themes, page: m.themes.title },
  modules: { nav: m.nav.modules, page: m.modules.title },
  documents: { nav: m.nav.documents, page: m.documents.title },
  animals: { nav: m.nav.animals.admin, page: m.animals.admin.title },
  site: { nav: m.nav.site.admin, page: m.site.admin.title },
  finance: { nav: m.nav.finance.admin, page: m.finance.admin.title },
  dms: { nav: m.nav.dms.admin, page: m.dms.admin.title },
  media: { nav: m.nav.groups.media, page: m.media.title },
};

/** Offen, nicht geändert: der Plan nennt sie nur (Entscheidung Joe). */
const ALLOWED = new Set(['retention', 'settings']);

describe('Überschriften der Einstellungsseiten', () => {
  for (const [key, { nav, page }] of Object.entries(PAGES)) {
    if (ALLOWED.has(key)) continue;
    it(`${key}: Überschrift gleich Rubrikname`, () => {
      expect(page).toBe(nav);
    });
  }
});
