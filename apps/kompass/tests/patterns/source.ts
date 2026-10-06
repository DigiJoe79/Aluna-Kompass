import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Gemeinsame Hilfe der Wächter unter `tests/patterns/` (docs/MUSTER.md, Fassung 0.2.6):
 * Quelltexte unter `src/` lesen und Treffer als `datei:zeile` melden, damit ein roter
 * Test sagt, wo — nicht nur, dass.
 */
export const SRC = path.resolve(import.meta.dirname, '../../src');

/** Alle `.ts`/`.tsx`-Dateien unter `dir` (Vorgabe `src/`), mit absolutem Pfad. */
export function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Pfad relativ zu `src/`, mit `/` getrennt. */
export const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');

export const read = (file: string): string => readFileSync(file, 'utf8');

/** Die Zeilennummer (ab 1) einer Stelle im Text. */
export const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Eine Zeile, die nur Kommentar ist (`//`, `/*`, `*`) — dort darf ein Muster erklärt werden. */
export const isCommentLine = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line);

/** `datei:zeile` jeder Zeile, die `pattern` trifft (Kommentarzeilen nur, wenn `comments`). */
export function matchingLines(file: string, text: string, pattern: RegExp, { comments = false }: { comments?: boolean } = {}): string[] {
  return text
    .split('\n')
    .flatMap((line, index) => (pattern.test(line) && (comments || !isCommentLine(line)) ? [`${relative(file)}:${index + 1}`] : []));
}

/**
 * Die öffnenden Tags `<name …>` im Text, auch über mehrere Zeilen. Das Ende ist das erste `>` außerhalb
 * von `{ … }` und von Zeichenketten — ein `=>` in einem Handler schließt den Tag nicht.
 */
export function openingTags(text: string, name: RegExp): { line: number; tag: string }[] {
  const found: { line: number; tag: string }[] = [];
  const start = new RegExp(`<(?:${name.source})(?=[\\s/>])`, 'g');
  for (let m = start.exec(text); m; m = start.exec(text)) {
    let depth = 0;
    let quote: string | null = null;
    let end = m.index + m[0].length;
    for (; end < text.length; end += 1) {
      const ch = text[end]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
    }
    found.push({ line: lineOf(text, m.index), tag: text.slice(m.index, end + 1) });
  }
  return found;
}

/** Der Text eines Aufrufs `prefix( … )` ab der öffnenden Klammer bis zur passenden schließenden. */
export function callArguments(text: string, prefix: string): { line: number; args: string }[] {
  const found: { line: number; args: string }[] = [];
  for (let at = text.indexOf(prefix); at !== -1; at = text.indexOf(prefix, at + prefix.length)) {
    let depth = 0;
    let i = at + prefix.length - 1; // die öffnende Klammer
    for (; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')' && (depth -= 1) === 0) break;
    }
    found.push({ line: lineOf(text, at), args: text.slice(at + prefix.length, i) });
  }
  return found;
}

/**
 * Eine Erlaubnisliste: Pfad (relativ zu `src/`) → Begründung. Der Wächter prüft beides — dass nichts
 * Unerlaubtes dasteht und dass keine Ausnahme veraltet ist (die Datei gibt es, der Verstoß ebenso).
 */
export type Allowlist = Readonly<Record<string, string>>;
