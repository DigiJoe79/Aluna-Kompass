import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, type CountedAllowlist } from './source';
import { hitsOf, STYLE_TYPE, TYPE_STYLE } from './type-scan';

/**
 * Zeilenhöhe, Versalien, Sperrung und Gewicht kommen aus Rolle oder Baustein (K10 Charge 3, Spec § 2 und § 6,
 * Designer § 9): kein `leading-*`, `uppercase`, `tracking-*`, `font-medium`, `font-bold` an Aufrufstellen.
 * `overline.tsx` und `ui/table.tsx` (Tabellenkopf, Spec § 9.3) sind die Orte für Versalien und Sperrung.
 * Geltungsbereich einschließlich `components/ui` (Designer § 13).
 * Ausnahmen gezählt je Datei. Gruppen: „Grafik, keine Schrift“ (`font-bold` bei Initialen, Dateiendung),
 * „Zeichen einzeln ablesbar“ (Startpasswort). Kein vorläufiger Eintrag (`OFFEN …`).
 */
export const ALLOWED: CountedAllowlist = {
  'app/(shell)/admin/media/asset-detail-dialog.tsx': { count: 1, reason: 'Grafik, keine Schrift: Dateiendung als Platzhalterbild (Versalien)' },
  'app/(shell)/admin/media/library-client.tsx': { count: 1, reason: 'Grafik, keine Schrift: Datei-Symbol (Versalien)' },
  'app/(shell)/admin/users/start-password-dialog.tsx': { count: 1, reason: 'Zeichen einzeln ablesbar: Startpasswort (Designer § 6)' },
  'app/(shell)/profile/page.tsx': { count: 1, reason: 'Grafik, keine Schrift: Initialen (font-bold)' },
  'app/global-error.tsx': { count: 4, reason: 'Ersetzt das Wurzel-Layout samt Schale, ohne Tokens und Bausteine (style mit lineHeight, letterSpacing, textTransform)' },
  'components/auth-card.tsx': { count: 1, reason: 'Grafik, keine Schrift: Initialen (font-bold)' },
  'components/forms/media-picker.tsx': { count: 1, reason: 'Grafik, keine Schrift: Dateiart als Platzhalterbild (Versalien)' },
  'components/media/asset-grid.tsx': { count: 1, reason: 'Grafik, keine Schrift: Dateiendung als Platzhalterbild (Versalien)' },
  'components/shell/user-menu.tsx': { count: 1, reason: 'Grafik, keine Schrift: Initialen (font-bold)' },
  'components/sortable-head.tsx': { count: 1, reason: 'Versalien des Tabellenkopfs: der Browser setzt sie am <button> zurück (03 B9, 04 B7)' },
};

/** Orte für Versalien und Sperrung (Spec § 6, § 9.3): `Overline` und der Tabellenkopf in `ui/table.tsx`. */
const LABEL_HOMES = new Set(['components/overline.tsx', 'components/ui/table.tsx']);
const hits = () => [...hitsOf(TYPE_STYLE), ...hitsOf(STYLE_TYPE)].filter(({ file }) => !LABEL_HOMES.has(file));

describe('keine Zeilenhöhe, Versalien, Sperrung oder Gewicht von Hand', () => {
  it('nur aus Rolle oder Baustein, außer der Erlaubnisliste', () => {
    expect(checkCountedAllowlist(hits(), ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits(), ALLOWED).stale);

  it('trifft Zeilenhöhe, Versalien, Sperrung, 500/700 — nicht normal-case, font-normal, font-semibold', () => {
    const line = (s: string) => [...s.matchAll(TYPE_STYLE)].map((m) => m[0]);
    expect(line(`"leading-[1.55] uppercase tracking-wide font-medium md:font-bold"`)).toEqual(['leading-[1.55]', 'uppercase', 'tracking-wide', 'font-medium', 'md:font-bold']);
    expect(line(`"normal-case font-normal font-semibold font-mono font-heading"`)).toEqual([]);
    expect(line(`s.toUpperCase()`)).toEqual([]);
  });
});
