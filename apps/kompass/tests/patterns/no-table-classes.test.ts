import { describe, expect, it } from 'vitest';
import { type Allowlist, matchingLines, read, relative, sourceFiles, allowlistHygiene, staleKeys } from './source';

/**
 * Kopf, Zebra und Zeilenhöhe einer Liste stehen in `components/ui/table.tsx` und nirgends sonst
 * (docs/MUSTER.md § G). Bis 0.2.5 trugen 29 Dateien eigene Kopf-, Zebra- und Höhenklassen; eine
 * Änderung am Standard erreichte sie nicht. Aufrufstellen ergänzen Breiten und Ausrichtung.
 */
const PATTERN = /bg-table-head|bg-zebra|h-\[52px\]/;

export const ALLOWED: Allowlist = {
  'components/ui/table.tsx': 'Hier steht der Standard.',
  'app/(shell)/admin/locales/locales-client.tsx': 'Raster aus `div` mit Zeilen zum Umsortieren, keine Tabelle.',
  'app/(shell)/admin/roles/role-editor.tsx': 'Raster aus `div` (Rechte-Matrix mit Beschriftungen), keine Tabelle.',
  'app/(shell)/admin/themes/theme-editor.tsx': 'Raster aus `div` für die Farbwerte, keine Tabelle.',
  'app/(shell)/admin/themes/theme-preview.tsx': 'Vorschau, die einen Tabellenkopf nachbildet, um die Theme-Farben zu zeigen.',
  'components/shell/rail.tsx': '`h-[52px]` ist die Höhe eines Navigationspunkts, keine Tabellenzeile.',
  'components/folder-tree/folder-sheet.tsx': '`h-[52px]` ist die Höhe von Auslöser und Titel des Ordner-Seitenfensters, keine Tabellenzeile.',
};

describe('keine eigenen Tabellenklassen', () => {
  const hits = sourceFiles().flatMap((file) => matchingLines(file, read(file), PATTERN).map((where) => ({ where, file: relative(file) })));

  it('Kopf-, Zebra- und Höhenklassen stehen nur in ui/table und der Erlaubnisliste', () => {
    expect(hits.filter(({ file }) => !(file in ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => staleKeys(ALLOWED, hits.map(({ file }) => file)));
});
