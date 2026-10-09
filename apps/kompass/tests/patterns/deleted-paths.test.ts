import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC } from './source';

/**
 * Diese Bausteine sind in Fassung 0.2.6 gegangen, weil ihre Aufgabe jetzt ein einziger Baustein
 * erledigt (docs/MUSTER.md). Taucht eine Datei wieder auf (etwa durch die shadcn-CLI oder einen
 * Merge-Rest), bauen Aufrufstellen wieder die zweite Gestalt — das fängt dieser Test, bevor es
 * jemand bemerkt. Die Importe sperrt zusätzlich `no-restricted-imports` in `eslint.config.mjs`.
 */
const DELETED: Readonly<Record<string, string>> = {
  'components/ui/alert.tsx': '`Notice` (§ A)',
  'components/ui/badge.tsx': '`StatusBadge` (§ F)',
  'components/forms/save-bar.tsx': '`FormActionBar` (§ B)',
  'components/forms/sticky-footer.tsx': '`FormActionBar` (§ B)',
  // Spec Seitenkopf (0.2.9): seltene Aktionen am Datensatz stehen im Seitenkopf, nicht als Karte am Seitenende.
  'components/forms/danger-section.tsx': '`RecordActions` (§ C)',
  'app/(shell)/admin/finance/panel-nav.tsx': '`components/panel-nav.tsx` (§ D)',
  'app/(shell)/admin/site/panel-nav.tsx': '`components/panel-nav.tsx` (§ D)',
};

describe('gestrichene Bausteine bleiben gestrichen', () => {
  it.each(Object.entries(DELETED))('%s gibt es nicht mehr — stattdessen %s', (file) => {
    expect(existsSync(path.join(SRC, file))).toBe(false);
  });
});
