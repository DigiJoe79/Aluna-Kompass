import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, messageTexts, read, relative, sourceFiles, staleKeys } from './source';

/**
 * Anlegen- und Hinzufügen-Knöpfe tragen kein „+“ (docs/MUSTER.md, „Seitenrahmen“; Entscheidung Joe
 * 2026-10-05): weder das Symbol (`Plus`, `CirclePlus`, … aus `lucide-react`) noch ein „+ “ im Text.
 * Der Wächter findet jeden Import eines Plus-Symbols; ein Plus, das etwas anderes ist (Zoom, Zähler),
 * steht mit Grund in der Erlaubnisliste.
 */
export const ALLOWED: Allowlist = {
  'components/media/crop-editor.tsx': 'Zoom: − / + am Schieber „Größe“ (Handover Ausschnitt, Board 2a), kein Anlegen.',
};

const PLUS_IMPORT = /import\s*\{[^}]*\b(?:Plus|PlusIcon|CirclePlus|SquarePlus|PlusCircle|PlusSquare)\b[^}]*\}\s*from\s*'lucide-react'/;

/** Texte, die mit „+“ beginnen, ohne etwas anzulegen — Schlüssel → Grund. */
export const ALLOWED_KEYS: Allowlist = {
  'contacts.moreRoles': 'Zähler weiterer Rollen in der Kartenzeile am Telefon („+1“, Runde 3, 038), kein Anlegen.',
};

describe('kein „+“ an Anlegen-Knöpfen', () => {
  const using = sourceFiles().filter((file) => PLUS_IMPORT.test(read(file))).map(relative);
  const plusTexts = messageTexts().filter(([, text]) => /^\+/.test(text.trim())).map(([key]) => key);

  it('kein Plus-Symbol aus lucide-react unter src/', () => {
    expect(using.filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => staleKeys(ALLOWED, using));

  it('kein Text in de.json beginnt mit „+“', () => {
    expect(plusTexts.filter((key) => !(key in ALLOWED_KEYS))).toEqual([]);
  });

  allowlistHygiene(ALLOWED_KEYS, () => staleKeys(ALLOWED_KEYS, plusTexts), 'Erlaubnisliste der Texte');
});
