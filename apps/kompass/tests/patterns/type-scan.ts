import path from 'node:path';
import { isCommentLine, read, relative, sourceFiles, SRC } from './source';

/**
 * Gemeinsame Suche der Schrift-Wächter (K10 Charge 3, Spec § 6 und § 9.3): `src/app` und `src/components`
 * einschließlich der Grundbausteine `components/ui` (Designer § 13). Ein Treffer je Vorkommen, nicht je Zeile —
 * zwei Größen in einer Zeile sind zwei Verstöße.
 */
export function scanFiles(): string[] {
  return [path.join(SRC, 'app'), path.join(SRC, 'components')].flatMap((dir) => sourceFiles(dir));
}

export function hitsOf(pattern: RegExp, files: string[] = scanFiles()): { file: string; where: string; match: string }[] {
  return files.flatMap((file) =>
    read(file)
      .split('\n')
      .flatMap((line, index) =>
        isCommentLine(line) ? [] : [...line.matchAll(pattern)].map((m) => ({ file: relative(file), where: `${relative(file)}:${index + 1}`, match: m[0] })),
      ),
  );
}

/** Varianten vorn (`sm:`, `[&_a]:`, `group-hover:`), dann die Klasse; davor und danach kein Klassenzeichen. */
const V = String.raw`(?<![\w\-\[\]:])(?:[\w\-\[\]&_>*.=]+:)*`;
const END = String.raw`(?![\w-])`;

/** Größe von Hand: `text-[…]` (auch `length:var(…)`) und die Tailwind-Stufen `text-xs` … `text-9xl`. */
export const SIZE = new RegExp(`${V}text-(?:\\[[^\\]]+\\]|xs|sm|base|lg|[2-9]?xl)${END}`, 'g');
export const STYLE_SIZE = /\bfontSize\s*:/g;

/** Zeilenhöhe, Versalien, Sperrung, Gewichte außer 400/600 (Designer § 9). `normal-case`, `font-normal`, `font-semibold` sind erlaubt. */
export const TYPE_STYLE = new RegExp(`${V}(?:leading-[\\w.\\[\\]%-]+|uppercase|tracking-[\\w.\\[\\]-]+|font-(?:thin|extralight|light|medium|bold|extrabold|black))${END}`, 'g');
export const STYLE_TYPE = /\b(?:lineHeight|letterSpacing|textTransform|fontWeight)\s*:/g;
