import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, type CountedAllowlist, openingTags, read, relative, sourceFiles } from './source';

/**
 * Fester Wert als Text (Entwurf E2, Designer 2026-10-17; docs/MUSTER.md § E): Ein Wert, der im Formular steht, aber
 * nicht änderbar ist, steht als `FixedValue` (bzw. `ManagedField`) — nie als gesperrtes oder schreibgeschütztes Feld.
 *
 * Geprüft werden `Input`, `Select` und `Textarea` mit einem `disabled` oder `readOnly` ohne Bedingung (`disabled`,
 * `readOnly`, `={true}`): Ein solches Feld zeigt immer nur einen festen Wert. Ein Feld, das nur gerade gesperrt ist
 * (`disabled={pending}`, `readOnly={!canManage}`), ist nicht gemeint und bleibt ein Feld.
 */
const FIELD = /Input|Select|Textarea/;
const ALWAYS = /\s(?:disabled|readOnly)(?:=\{true\})?(?=[\s/>])/;

export const ALLOWED: CountedAllowlist = {
  'app/(shell)/admin/themes/theme-preview.tsx': { count: 1, reason: 'Vorschau eines Eingabefelds in den Farben des Themes, kein Formular.' },
};

describe('fester Wert statt gesperrtem Feld (E2)', () => {
  const hits = sourceFiles().flatMap((file) => {
    const text = read(file);
    return openingTags(text, FIELD)
      .filter(({ tag }) => ALWAYS.test(tag))
      .map(({ line }) => ({ file: relative(file), where: `${relative(file)}:${line}` }));
  });

  it('kein Feld, das immer gesperrt oder schreibgeschützt ist', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits, ALLOWED).stale);
});
