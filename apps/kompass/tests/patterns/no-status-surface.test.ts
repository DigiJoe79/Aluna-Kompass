import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCountedAllowlist, type CountedAllowlist, isCommentLine, read, relative, sourceFiles, SRC } from './source';

/**
 * Statusfarbe als Fläche oder Rahmen steht in `Notice`, `StatusBadge` und `components/ui` (K10 Charge 2, T4).
 * Bis 0.2.8 bauten 40 Dateien eigene Kästen; Info-Blau gibt es seitdem nicht mehr — Farbe nur für Zustände,
 * die eine Handlung verlangen (Designer 2026-10-08). Gezählt je Datei.
 */
const STATUS_SURFACE = /(?<![\w-])(?:bg-(?:warning|info|error|success)-(?:bg|surface)|border-(?:[xytrblse]-)?(?:warning|info|error|success))(?![\w-])/g;

const OWNERS = /^components\/(?:ui\/|notice\.tsx$|status-badge\.tsx$)/;

export function statusSurfaceCount(line: string): number {
  return isCommentLine(line) ? 0 : (line.match(STATUS_SURFACE) ?? []).length;
}

const ALLOWED: CountedAllowlist = {
  // Endgültige Einträge (Spec § 3.6/§ 3.7):
  'app/(shell)/animals/proposals/[id]/same-as-review.tsx': { count: 1, reason: 'Markierung abweichender Werte der Zuordnung (Board Vorschläge 5b), keine Meldung und keine Wahl — wie die Diff-Markierung im Protokoll.' },
  'components/finance/balance-indicator.tsx': { count: 2, reason: 'Zustand eines Werts (Saldo), keine Meldung.' },
  'components/finance/limit-progress.tsx': { count: 1, reason: 'Grenzmarke im Fortschrittsbalken, keine Meldung.' },
  'components/forms/form-error-summary.tsx': { count: 2, reason: 'Selbst Baustein (Fehlerzusammenfassung, MUSTER § A).' },
  'components/forbidden-card.tsx': { count: 1, reason: 'Selbst Baustein (403-Kennung).' },
  'app/error.tsx': { count: 1, reason: 'Fehlergrenze (500-Kennung).' },
  'components/site/site-job-indicator.tsx': { count: 2, reason: 'Kopfzeilen-Anzeige „n nicht publiziert“ (Board Vorschläge 8a, Designer 2026-10-10): ein Zustand der Webseite in der Hülle, keine Meldung.' },
  'app/(shell)/error.tsx': { count: 2, reason: 'Fehlergrenze (Rahmen und 500-Kennung).' },
  'app/(shell)/admin/themes/theme-preview.tsx': { count: 4, reason: 'Bildet das Theme nach, um seine Farben zu zeigen.' },
  'app/(shell)/admin/audit/audit-detail.tsx': { count: 1, reason: 'Diff-Markierung des neuen Werts, keine Meldung.' },
  'app/(shell)/finance/donations/run/preview-groups.tsx': { count: 3, reason: 'Gruppenstrich je Gruppe (Wort plus Farbe), keine Meldung.' },
  'components/folder-tree/folder-tree.tsx': { count: 1, reason: 'Leiste beim Verschieben per Tastatur (Zustand mit Tastenkürzeln), keine Meldung.' },
  'components/folder-tree/name-input-row.tsx': { count: 1, reason: 'Feldrahmen im Fehlerzustand wie `ui/input` (aus `aria-invalid`); Höhe der Baumzeile statt `--field-h`, Kandidat für `ui/input`.' },
  'components/forms/localized-field.tsx': { count: 1, reason: 'Feldrahmen im Fehlerzustand wie `ui/input` (aus `aria-invalid` am Feld); Präfix-Feld, Kandidat für `ui/input`.' },
  'components/finance/amount-field.tsx': { count: 1, reason: 'Feldrahmen im Fehlerzustand wie `ui/input` (aus `aria-invalid` am Feld); Suffix-Feld, Kandidat für `ui/input`.' },
};

describe('Heuristik', () => {
  it('trifft Flächen und Rahmen in Statusfarbe, auch mit Seite', () => {
    for (const hit of ['bg-warning-bg', 'border-error', 'border-t-warning', 'border-l-info', 'aria-invalid:border-error', 'bg-success-surface'])
      expect(statusSurfaceCount(`<div className="${hit}" />`), hit).toBe(1);
  });
  it('trifft keine Textfarbe, keine anderen Tokens, keine Kommentare', () => {
    for (const miss of ['text-error', 'text-warning', 'bg-agent-bg', 'border-agent', 'bg-error-bg-strong', 'border-line', 'border-errorish'])
      expect(statusSurfaceCount(`<div className="${miss}" />`), miss).toBe(0);
    expect(statusSurfaceCount('// bg-warning-bg war hier')).toBe(0);
  });
});

describe('keine Statusflächen außerhalb der Bausteine', () => {
  const hits = [path.join(SRC, 'app'), path.join(SRC, 'components')]
    .flatMap((dir) => sourceFiles(dir))
    .filter((file) => !OWNERS.test(relative(file)))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => Array.from({ length: statusSurfaceCount(line) }, () => ({ where: `${relative(file)}:${index + 1}`, file: relative(file) }))),
    );

  it('Kästen über Notice, Marken über StatusBadge; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  it('keine vorläufigen Einträge mehr', () => {
    expect(Object.entries(ALLOWED).filter(([, { reason }]) => reason.startsWith('OFFEN')).map(([file]) => file)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).stale).toEqual([]);
  });
});
