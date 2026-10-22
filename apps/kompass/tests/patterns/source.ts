import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import messages from '../../messages/de.json';

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

/** Das Repo und Pfade relativ dazu, mit `/` getrennt — für Wächter, die App und Pakete lesen. */
export const REPO = path.resolve(SRC, '../../..');
export const fromRepo = (file: string): string => path.relative(REPO, file).split(path.sep).join('/');

/** Die `src`-Ordner aller Pakete: `packages/<name>/src` und `packages/modules/<name>/src`. */
export function packageSourceDirs(): string[] {
  const packages = path.join(REPO, 'packages');
  return readdirSync(packages)
    .flatMap((name) => (name === 'modules' ? readdirSync(path.join(packages, 'modules')).map((m) => path.join(packages, 'modules', m, 'src')) : [path.join(packages, name, 'src')]))
    .filter((dir) => existsSync(dir));
}

/** Ausgelieferter Quelltext: keine Tests, keine E2E-Hilfen (`__e2e`), keine Attrappen (`src/testing/`). */
export const isProductSource = (file: string): boolean => !/\.test\.tsx?$/.test(file) && !file.includes('__e2e') && !fromRepo(file).includes('/src/testing/');

/** Ein Treffer: `where` (`datei:zeile`) für die Meldung, `file` als Schlüssel der Erlaubnisliste. */
export type Hit = { where: string; file: string };

/**
 * Die Treffer je Zeile: `count` liefert für eine Zeile `true` (ein Treffer) oder eine Zahl. Kommentarzeilen zählen nie.
 * `name` macht aus dem absoluten Pfad den Schlüssel (Vorgabe: relativ zu `src/`).
 */
export function lineHits(files: string[], count: (line: string) => number | boolean, name: (file: string) => string = relative): Hit[] {
  return files.flatMap((file) =>
    read(file)
      .split('\n')
      .flatMap((line, index) => {
        if (isCommentLine(line)) return [];
        const n = Number(count(line));
        return Array.from({ length: n }, () => ({ where: `${name(file)}:${index + 1}`, file: name(file) }));
      }),
  );
}

/** Jeder Text der Sprachdatei `messages/de.json` als `[Schlüssel, Text]`, der Schlüssel mit Punkten. */
export function messageTexts(node: unknown = messages, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => messageTexts(value, prefix ? `${prefix}.${key}` : key));
}

/** Der Eintrag der Sprachdatei unter `key` (mit Punkten), oder `undefined`. */
export const messageAt = (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages);

/** Die Übersetzer einer Datei: Variable → Namensraum (`const t = useTranslations('dms.admin')`; ohne Namensraum `''`). */
export function translators(text: string): Map<string, string> {
  return new Map([...text.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\((?:'([^']*)')?\)/g)].map((m) => [m[1]!, m[2] ?? '']));
}

/** Der Text von `variable('key')` aus der Sprachdatei — `undefined`, wenn die Variable kein Übersetzer ist oder der Schlüssel fehlt. */
export function translate(ts: Map<string, string>, variable: string, key: string): string | undefined {
  const ns = ts.get(variable);
  if (ns === undefined) return undefined;
  const value = messageAt(ns ? `${ns}.${key}` : key);
  return typeof value === 'string' ? value : undefined;
}

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
 * Der Ausdruck im Attribut `name={…}` des Tags selbst, bis zur passenden Klammer — nicht ein gleichnamiges Attribut eines
 * verschachtelten Elements (`actions={<X status={…} />}`). `null`, wenn der Tag das Attribut nicht trägt.
 */
export function attributeExpression(tag: string, name: string): string | null {
  const opens = new RegExp(`\\s${name}=\\{$`);
  let depth = 0;
  for (let i = 0; i < tag.length; i += 1) {
    const ch = tag[i]!;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (depth === 0 && opens.test(tag.slice(Math.max(0, i - name.length - 2), i + 2))) {
      let inner = 0;
      for (let j = i + 1; j < tag.length; j += 1) {
        if (tag[j] === '{') inner += 1;
        else if (tag[j] === '}' && (inner -= 1) === 0) return tag.slice(i + 2, j);
      }
      return tag.slice(i + 2);
    }
  }
  return null;
}

/**
 * Eine Erlaubnisliste: Pfad (relativ zu `src/`) → Begründung. Der Wächter prüft beides — dass nichts
 * Unerlaubtes dasteht und dass keine Ausnahme veraltet ist (die Datei gibt es, der Verstoß ebenso).
 */
export type Allowlist = Readonly<Record<string, string>>;

/**
 * Erlaubnisliste mit Trefferzahl: Pfad → wie viele Treffer die Datei haben darf, und warum. Gebunden an die
 * Zahl statt an die ganze Datei, damit ein zusätzliches rohes Datum in einer freigegebenen Datei auffällt
 * (K10-Review, 2026-10-07). Weniger Treffer als erlaubt heißt: Die Ausnahme ist veraltet, die Zahl sinkt mit.
 */
export type CountedAllowlist = Readonly<Record<string, { count: number; reason: string }>>;

export function checkCountedAllowlist(hits: Hit[], allowed: CountedAllowlist): { unexpected: string[]; stale: string[] } {
  const byFile = new Map<string, Hit[]>();
  for (const hit of hits) byFile.set(hit.file, [...(byFile.get(hit.file) ?? []), hit]);
  const unexpected: string[] = [];
  for (const [file, found] of byFile) {
    const limit = allowed[file]?.count;
    if (limit === undefined) unexpected.push(...found.map(({ where }) => where));
    else if (found.length > limit) unexpected.push(`${file}: ${found.length} Treffer, erlaubt ${limit} (${found.map(({ where }) => where).join(', ')})`);
  }
  const stale = Object.entries(allowed).flatMap(([file, { count }]) => {
    const found = byFile.get(file)?.length ?? 0;
    return found < count ? [`${file}: ${found} Treffer, erlaubt ${count}`] : [];
  });
  return { unexpected, stale };
}

/** Die Datei und die Dateien ihres Ordners, die sie über `./name` einbindet, auch über mehrere Stufen (Seite → Client → Tabelle). */
export function localImports(file: string, seen: Set<string> = new Set()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const next = [...read(file).matchAll(/from '\.\/([\w-]+)'/g)]
    .flatMap((m) => ['.tsx', '.ts'].map((ext) => path.join(path.dirname(file), m[1]! + ext)))
    .filter((candidate) => existsSync(candidate));
  return [file, ...next.flatMap((candidate) => localImports(candidate, seen))];
}

/** Ob die Datei oder eine Datei ihres Ordners, die sie einbindet (`localImports`), `pattern` enthält. */
export const inFileOrLocalImport = (file: string, pattern: RegExp): boolean => localImports(file).some((f) => pattern.test(read(f)));

/** Der Wert von `className=` in einem öffnenden Tag: der Text eines Strings oder der Ausdruck in `{ … }`. */
export function classNameValue(tag: string): string | null {
  // Nur auf oberster Ebene des Tags: Ein `className` in einer Prop (`actions={<Link className=…>}`) gehört einem anderen Element.
  let at = -1;
  let level = 0;
  let quote: string | null = null;
  for (let i = 0; i < tag.length; i += 1) {
    const ch = tag[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = level === 0 ? ch : null;
    else if (ch === '{') level += 1;
    else if (ch === '}') level -= 1;
    else if (level === 0 && /\s/.test(ch) && tag.startsWith('className=', i + 1)) {
      at = i;
      break;
    }
  }
  if (at === -1) return null;
  const start = tag.indexOf('=', at) + 1;
  const open = tag[start];
  if (open === '"' || open === "'") return tag.slice(start + 1, tag.indexOf(open, start + 1));
  if (open !== '{') return null;
  let depth = 0;
  for (let i = start; i < tag.length; i += 1) {
    if (tag[i] === '{') depth += 1;
    else if (tag[i] === '}' && (depth -= 1) === 0) return tag.slice(start + 1, i);
  }
  return null;
}

type AnyAllowlist = Allowlist | CountedAllowlist;
const reasonOf = (entry: AnyAllowlist[string]): string => (typeof entry === 'string' ? entry : entry.reason);

/** Die Schlüssel einer Erlaubnisliste, die unter `using` (den Dateien bzw. Schlüsseln mit Verstoß) nicht vorkommen. */
export function staleKeys(allowed: AnyAllowlist, using: Iterable<string>): string[] {
  const set = new Set(using);
  return Object.keys(allowed).filter((key) => !set.has(key));
}

/** Was an einer Erlaubnisliste nicht stimmt: Eintrag ohne Grund, vorläufiger Eintrag (`OFFEN …`), veraltete Ausnahme. */
export function allowlistIssues(allowed: AnyAllowlist, stale: string[]): string[] {
  return [
    ...Object.entries(allowed).flatMap(([key, entry]) => (reasonOf(entry).trim() === '' ? [`${key}: ohne Grund`] : [])),
    ...Object.entries(allowed).flatMap(([key, entry]) => (/^OFFEN\b/.test(reasonOf(entry).trim()) ? [`${key}: vorläufig (OFFEN)`] : [])),
    ...stale.map((entry) => `${entry}: nicht mehr nötig`),
  ];
}

/**
 * Die Hygiene einer Erlaubnisliste, für alle Wächter gleich (`allowlists.test.ts` verlangt sie für jede): jeder Eintrag
 * mit Grund, keiner vorläufig, jeder noch nötig. `stale` liefert die veralteten Einträge — bei gezählten Listen
 * `checkCountedAllowlist(…).stale`, sonst `staleKeys(…)`.
 */
export function allowlistHygiene(allowed: AnyAllowlist, stale: () => string[], name = 'Erlaubnisliste'): void {
  it(`${name}: jeder Eintrag mit Grund, keiner vorläufig, jeder noch nötig`, () => {
    expect(allowlistIssues(allowed, stale())).toEqual([]);
  });
}
