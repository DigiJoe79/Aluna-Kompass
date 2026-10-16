import { describe, expect, it } from 'vitest';
import { checkCountedAllowlist, type CountedAllowlist } from './source';
import { hitsOf, SIZE, STYLE_SIZE } from './type-scan';

/**
 * Keine Schriftgröße außer den zehn Rollen (K10 Charge 3, Spec § 6; docs/MUSTER.md „Schrift“). Bis 0.2.10 standen
 * 1.043 `text-[…px]` in 245 Dateien, dazu `text-sm`/`text-base` — eine Änderung an einer Stufe erreichte sie nicht.
 * Ausnahmen gezählt je Datei: eine zusätzliche Größe in einer freigegebenen Datei fällt auf.
 * Gruppen: „Grafik, keine Schrift“ (Größe folgt dem Kasten), „Feldschrift“ (`--field-font` in den Grundbausteinen,
 * Spec § 9.3) und „Feldschrift wie ui/input“. Geltungsbereich einschließlich `components/ui` (Designer § 13).
 * Kein vorläufiger Eintrag (`OFFEN …`): Was bleibt, ist eine Ausnahme mit Grund.
 */
const ALLOWED: CountedAllowlist = {
  'app/(shell)/admin/media/asset-detail-dialog.tsx': { count: 1, reason: 'Grafik, keine Schrift: Dateiendung als Platzhalterbild' },
  'app/(shell)/admin/media/library-client.tsx': { count: 1, reason: 'Grafik, keine Schrift: Datei-Symbol (Dateiendung)' },
  'app/(shell)/dms/receive/file-dropzone.tsx': { count: 1, reason: 'Grafik, keine Schrift: Datei-Symbol' },
  'app/(shell)/profile/page.tsx': { count: 1, reason: 'Grafik, keine Schrift: Initialen' },
  'app/global-error.tsx': { count: 5, reason: 'Ersetzt das Wurzel-Layout samt Schale, ohne Tokens und Bausteine (style mit fontSize)' },
  'components/steps.tsx': { count: 2, reason: 'Grafik, keine Schrift: Ziffern im Schrittmarker (24/20 px, Entwurf E3)' },
  'components/auth-card.tsx': { count: 2, reason: 'Grafik, keine Schrift: Initialen und Wortmarke der Anmeldeseite' },
  'components/drop-overlay.tsx': { count: 1, reason: 'Grafik, keine Schrift: Datei-Symbol' },
  'components/finance/amount-field.tsx': { count: 1, reason: 'Feldschrift wie ui/input (`--field-font`, Spec § 9.3)' },
  'components/folder-tree/folder-field.tsx': { count: 1, reason: 'Feldschrift wie ui/input (`--field-font`, Spec § 9.3)' },
  'components/forms/media-picker.tsx': { count: 1, reason: 'Grafik, keine Schrift: Dateiart als Platzhalterbild' },
  'components/media/asset-grid.tsx': { count: 1, reason: 'Grafik, keine Schrift: Dateiendung als Platzhalterbild' },
  'components/shell/topbar.tsx': { count: 1, reason: 'Grafik, keine Schrift: Platzhalter des Vereinslogos' },
  'components/ui/button.tsx': { count: 1, reason: 'Feldschrift 14/16 px aus `--field-font` (iOS-Zoom unter 16 px, F8a), keine Rolle' },
  'components/ui/input.tsx': { count: 1, reason: 'Feldschrift 14/16 px aus `--field-font` (iOS-Zoom unter 16 px, F8a), keine Rolle' },
  'components/ui/select.tsx': { count: 1, reason: 'Feldschrift 14/16 px aus `--field-font` (iOS-Zoom unter 16 px, F8a), keine Rolle' },
  'components/ui/textarea.tsx': { count: 1, reason: 'Feldschrift 14/16 px aus `--field-font` (iOS-Zoom unter 16 px, F8a), keine Rolle' },
};

const hits = () => [...hitsOf(SIZE), ...hitsOf(STYLE_SIZE)];

describe('keine Schriftgröße von Hand', () => {
  it('nur Rollen, außer der Erlaubnisliste', () => {
    expect(checkCountedAllowlist(hits(), ALLOWED).unexpected).toEqual([]);
  });

  it('kein vorläufiger Eintrag mehr', () => {
    const open = Object.entries(ALLOWED).filter(([, { reason }]) => reason.startsWith('OFFEN'));
    expect(open.map(([file]) => file)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig (Zahl sinkt mit)', () => {
    expect(checkCountedAllowlist(hits(), ALLOWED).stale).toEqual([]);
  });

  it('erkennt Größe in Variante, Bedingung und Feldschrift, nicht die Rolle', () => {
    const line = (s: string) => [...s.matchAll(SIZE)].map((m) => m[0]);
    expect(line(`cn('text-meta', open && 'text-[12px]')`)).toEqual(['text-[12px]']);
    expect(line(`"sm:text-sm md:text-[15px] text-body"`)).toEqual(['sm:text-sm', 'md:text-[15px]']);
    expect(line(`'text-[length:var(--field-font)]'`)).toEqual(['text-[length:var(--field-font)]']);
    expect(line(`'text-section text-figure text-ink text-muted-ink text-pretty'`)).toEqual([]);
  });
});
