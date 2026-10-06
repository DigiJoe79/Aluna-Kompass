import { describe, expect, it } from 'vitest';
import messages from '../../messages/de.json';
import { type Allowlist, read, relative, sourceFiles } from './source';

/**
 * Anlegen- und Hinzufügen-Knöpfe tragen kein „+“ (docs/MUSTER.md, „Seitenrahmen“; Entscheidung Joe
 * 2026-10-05): weder das Symbol (`Plus`, `CirclePlus`, … aus `lucide-react`) noch ein „+ “ im Text.
 * Der Wächter findet jeden Import eines Plus-Symbols; ein Plus, das etwas anderes ist (Zoom, Zähler),
 * steht mit Grund in der Erlaubnisliste.
 */
const ALLOWED: Allowlist = {};

const PLUS_IMPORT = /import\s*\{[^}]*\b(?:Plus|PlusIcon|CirclePlus|SquarePlus|PlusCircle|PlusSquare)\b[^}]*\}\s*from\s*'lucide-react'/;

function texts(value: unknown, path: string): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => texts(child, `${path}.${key}`));
  return [];
}

describe('kein „+“ an Anlegen-Knöpfen', () => {
  it('kein Plus-Symbol aus lucide-react unter src/', () => {
    const violations = sourceFiles()
      .filter((file) => PLUS_IMPORT.test(read(file)))
      .map(relative)
      .filter((file) => !(file in ALLOWED));
    expect(violations).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const using = new Set(sourceFiles().filter((file) => PLUS_IMPORT.test(read(file))).map(relative));
    expect(Object.keys(ALLOWED).filter((file) => !using.has(file))).toEqual([]);
  });

  it('kein Text in de.json beginnt mit „+“', () => {
    expect(texts(messages, '').filter(({ text }) => /^\+/.test(text.trim())).map(({ path }) => path)).toEqual([]);
  });
});
