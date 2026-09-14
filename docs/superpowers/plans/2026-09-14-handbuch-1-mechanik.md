# Handbuch und Hilfe — Plan 1: Mechanik und Gerüst

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Handbuch liegt als Markdown in `docs/handbuch/`, wird ins Image kopiert und in der App gerendert: ein „?" in der Kopfleiste öffnet ein Panel mit dem Kurzabsatz zur aktuellen Seite, `/help/<doc>` zeigt die ganze Seite mit Inhaltsverzeichnis, die Befehlspalette findet Handbuchseiten. Alle Seiten aus der Spec existieren mit Titel und Kurzabsatz; drei sind vollständig.

**Architecture:** Der Kern liest das Handbuch (`packages/core/src/help/handbook.ts`: Seite, Verzeichnis, Bilder, Pfadprüfung); `packages/markdown` rendert es mit eigenem Schema (`renderHandbook`: Bilder erlaubt, Überschriften eine Stufe tiefer, `.md`-Links → `/help/…`). Die Zuordnung Route → Seite lebt in der App (`apps/kompass/src/lib/help.ts`, `CORE_HELP` plus `help` der eingeschalteten Manifeste, längster Treffer über `matches()` aus `navigation.ts`). Drei Routen: Seite `/help/[[...doc]]`, Bilder `/help-bilder/[...path]`, Panel-Daten `/api/help?path=`. Das Panel ist ein `Sheet` rechts, das beim Öffnen lädt.

**Tech Stack:** TypeScript, Next 16 App Router (Server Components, Route Handler), next-intl, unified/remark/rehype (`packages/markdown`), Vitest, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-09-14-handbuch-und-hilfe-design.md` — dieser Plan setzt § 13 Schritt 1 um. Die Kurzabsätze aller Seiten stehen in Task 5 wörtlich; der ausführende Agent formuliert keine.

## Global Constraints

- Handbuchseiten: Zeile 1 `# Titel`, dann Leerzeile, dann **ein** Absatz (Kurzabsatz), dann frei. Dateinamen klein, Bindestrich, keine Umlaute. Sie-Form, Anführungszeichen „so“. `tests/german-quotes.test.ts` prüft ab diesem Plan auch `docs/handbuch`.
- Kein UI-Text im Code; neue Schlüssel nur die aus Spec § 9 in `apps/kompass/messages/de.json`. `tests/message-keys.test.ts` prüft feste Schlüssel — Schlüssel vor Verwendung anlegen.
- Keine Farbwerte im Code, nur Tokens.
- Am Kern nur: `HelpEntry`, `ModuleManifest.help?`, `RuntimeEnv.handbookDir`, `KOMPASS_HANDBOOK_DIR`, das neue Verzeichnis `src/help/`. Keine Seed-, Modul- oder Testdaten ändern (die Manifeste bekommen nur `help: […]`).
- Pfade aus URLs (`doc`, Bildpfad) werden im Kern gegen `..` und absolute Pfade geprüft; Tests decken das.
- Befehle: Unit `cd <paket> && npx vitest run <datei>`; Typecheck `pnpm typecheck` (Wurzel); E2E einzeln `cd apps/kompass && npx playwright test e2e/<datei>`; am Ende `pnpm verify` (Wurzel, ~4 min, Docker).
- Commit je Task, kein Push. Nur die im Task genannten Dateien stagen, nie `git add -A`. Commit-Trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_01LeMDKEvZqDirpaxdVbp436`.
- Beim Ausführen von `next dev` schreibt Next `apps/kompass/AGENTS.md`/`CLAUDE.md` neu — diese Dateien nicht stagen, wenn sie nur dadurch geändert sind.

---

### Task 1: Kern liest das Handbuch

**Files:**
- Modify: `packages/core/src/app.ts` (`envSchema`, `RuntimeEnv`, `readEnv`)
- Modify: `packages/core/src/modules/manifest.ts` (`HelpEntry`, `ModuleManifest.help?`)
- Create: `packages/core/src/help/handbook.ts`
- Modify: `packages/core/src/index.ts` (Export)
- Create: `packages/core/tests/fixtures/handbuch/inhalt.md`, `…/einstieg/oberflaeche.md`, `…/akte/post-ablegen.md`, `…/ohne-kurzabsatz.md`, `…/bilder/akte/eingang.png`
- Test: `packages/core/tests/handbook.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HelpEntry { href: string; doc: string }
  // ModuleManifest.help?: readonly HelpEntry[]
  // RuntimeEnv.handbookDir: string | null   (aus KOMPASS_HANDBOOK_DIR)
  export interface HandbookPage { doc: string; title: string; lead: string; body: string }
  export interface HandbookChapter { title: string; pages: { doc: string; title: string }[] }
  export function handbookDir(env: Pick<RuntimeEnv, 'handbookDir'>): string
  export function parseHandbookPage(doc: string, markdown: string): HandbookPage
  export function readHandbookPage(env: Pick<RuntimeEnv, 'handbookDir'>, doc: string): HandbookPage | null
  export function readHandbookIndex(env: Pick<RuntimeEnv, 'handbookDir'>): string
  export function parseHandbookIndex(markdown: string): HandbookChapter[]
  export function readHandbookAsset(env: Pick<RuntimeEnv, 'handbookDir'>, rel: string): { bytes: Uint8Array; mimeType: string } | null
  export function listHandbookDocs(env: Pick<RuntimeEnv, 'handbookDir'>): string[]
  ```
  `body` ist alles **nach** der Titelzeile (schließt den Kurzabsatz ein); die Seite rendert den Titel selbst.

- [x] **Step 1: Fixture anlegen**

`packages/core/tests/fixtures/handbuch/inhalt.md`:

```markdown
- Einstieg
  - [Die Oberfläche](einstieg/oberflaeche.md)
- Akte
  - [Post ablegen](akte/post-ablegen.md)
- [Ohne Kurzabsatz](ohne-kurzabsatz.md)
```

`packages/core/tests/fixtures/handbuch/einstieg/oberflaeche.md`:

```markdown
# Die Oberfläche

Links die Schiene mit den Bereichen, daneben die Seiten des Bereichs, oben die
Kopfleiste. Hier finden Sie sich zurecht.

## Die Schiene

Eine Zeile je Bereich.
```

`packages/core/tests/fixtures/handbuch/akte/post-ablegen.md`:

```markdown
# Post ablegen

Ein PDF auf einen Ordner ziehen, Art und Betreff bestätigen — fertig.

![Der Eingang](../bilder/akte/eingang.png)

Mehr dazu unter [Die Oberfläche](../einstieg/oberflaeche.md).
```

`packages/core/tests/fixtures/handbuch/ohne-kurzabsatz.md`:

```markdown
# Ohne Kurzabsatz

## Gleich eine Überschrift

Text.
```

Das Bild `packages/core/tests/fixtures/handbuch/bilder/akte/eingang.png` ist ein 1×1-PNG:

```bash
mkdir -p packages/core/tests/fixtures/handbuch/bilder/akte
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d > packages/core/tests/fixtures/handbuch/bilder/akte/eingang.png
```

- [x] **Step 2: Tests schreiben**

`packages/core/tests/handbook.test.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { handbookDir, listHandbookDocs, parseHandbookIndex, parseHandbookPage, readEnv, readHandbookAsset, readHandbookIndex, readHandbookPage } from '../src';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/handbuch');
const env = readEnv({ SESSION_SECRET: 'x'.repeat(32), KOMPASS_HANDBOOK_DIR: FIXTURE });

describe('handbook', () => {
  it('takes the directory from the environment and falls back to the repo', () => {
    expect(handbookDir(env)).toBe(FIXTURE);
    expect(handbookDir({ handbookDir: null })).toMatch(/docs[\\/]handbuch$/);
  });

  it('splits title, lead paragraph and body', () => {
    const page = readHandbookPage(env, 'einstieg/oberflaeche')!;
    expect(page.title).toBe('Die Oberfläche');
    expect(page.lead).toBe('Links die Schiene mit den Bereichen, daneben die Seiten des Bereichs, oben die\nKopfleiste. Hier finden Sie sich zurecht.');
    expect(page.body.startsWith('Links die Schiene')).toBe(true);
    expect(page.body).toContain('## Die Schiene');
    expect(page.body).not.toContain('# Die Oberfläche');
  });

  it('leaves the lead empty when a heading, list or image follows the title', () => {
    expect(readHandbookPage(env, 'ohne-kurzabsatz')!.lead).toBe('');
    expect(parseHandbookPage('x', '# T\n\n- eins\n').lead).toBe('');
    expect(parseHandbookPage('x', '# T\n\n![b](a.png)\n').lead).toBe('');
  });

  it('refuses unknown, escaping and absolute docs', () => {
    expect(readHandbookPage(env, 'gibt-es-nicht')).toBeNull();
    expect(readHandbookPage(env, '../package')).toBeNull();
    expect(readHandbookPage(env, '/etc/passwd')).toBeNull();
    expect(readHandbookPage(env, 'inhalt')).toBeNull();
  });

  it('reads and parses the index into chapters', () => {
    const chapters = parseHandbookIndex(readHandbookIndex(env));
    expect(chapters).toEqual([
      { title: 'Einstieg', pages: [{ doc: 'einstieg/oberflaeche', title: 'Die Oberfläche' }] },
      { title: 'Akte', pages: [{ doc: 'akte/post-ablegen', title: 'Post ablegen' }] },
      { title: 'Ohne Kurzabsatz', pages: [{ doc: 'ohne-kurzabsatz', title: 'Ohne Kurzabsatz' }] },
    ]);
  });

  it('serves images below bilder/ with their mime type and nothing else', () => {
    const asset = readHandbookAsset(env, 'akte/eingang.png')!;
    expect(asset.mimeType).toBe('image/png');
    expect(asset.bytes.byteLength).toBeGreaterThan(0);
    expect(readHandbookAsset(env, '../akte/post-ablegen.md')).toBeNull();
    expect(readHandbookAsset(env, '../../inhalt.md')).toBeNull();
    expect(readHandbookAsset(env, 'akte/eingang.txt')).toBeNull();
  });

  it('lists every doc except the index', () => {
    expect(listHandbookDocs(env).sort()).toEqual(['akte/post-ablegen', 'einstieg/oberflaeche', 'ohne-kurzabsatz']);
  });
});
```

- [x] **Step 3: Rot**

Run: `cd packages/core && npx vitest run tests/handbook.test.ts`
Expected: FAIL — Exporte fehlen.

- [x] **Step 4: `RuntimeEnv` und Manifest**

In `packages/core/src/app.ts`, `envSchema`, nach `KOMPASS_DOCUMENT_TEMPLATES_DIR`:

```ts
  KOMPASS_HANDBOOK_DIR: z.string().min(1).optional(),
```

`RuntimeEnv`, nach `documentTemplatesDir`:

```ts
  /** Das Handbuch; im Container gesetzt, in der Entwicklung `docs/handbuch` im Repo. */
  handbookDir: string | null;
```

`readEnv`, im Rückgabeobjekt nach `documentTemplatesDir`:

```ts
    handbookDir: v.KOMPASS_HANDBOOK_DIR ?? null,
```

In `packages/core/src/modules/manifest.ts` vor `export interface ModuleManifest`:

```ts
/** Welche Handbuchseite zu einer Route gehört. Der Kern kennt keine Routen; die App wertet das aus. */
export interface HelpEntry {
  /** Routenpräfix, an der Segmentgrenze verglichen wie die Navigation. */
  href: string;
  /** Pfad der Handbuchseite ohne `.md`, relativ zu `docs/handbuch/`: 'akte/post-ablegen'. */
  doc: string;
}
```

Und in `ModuleManifest` nach `moduleIcon?: string;`:

```ts
  /** Hilfe je Route des Moduls. Längster `href` gewinnt. */
  help?: readonly HelpEntry[];
```

- [x] **Step 5: `handbook.ts`**

`packages/core/src/help/handbook.ts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeEnv } from '../app';

/** In der Entwicklung liegt das Handbuch im Repo; der Container setzt `KOMPASS_HANDBOOK_DIR`. */
const REPO_HANDBOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/handbuch');

type Env = Pick<RuntimeEnv, 'handbookDir'>;

export interface HandbookPage {
  doc: string;
  title: string;
  /** Der Kurzabsatz direkt unter dem Titel, Markdown; leer, wenn keiner da ist. */
  lead: string;
  /** Alles nach der Titelzeile, Markdown — schließt den Kurzabsatz ein. */
  body: string;
}

export interface HandbookChapter {
  title: string;
  pages: { doc: string; title: string }[];
}

const DOC = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };

export function handbookDir(env: Env): string {
  return env.handbookDir ?? REPO_HANDBOOK;
}

/** Ein Pfad unterhalb von `root`, oder null, wenn er hinausführt. */
function inside(root: string, rel: string): string | null {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

/** Zeile 1 `# Titel`, dann der erste Absatz — nur wenn es ein Absatz ist, keine Überschrift, Liste, Bild, Zitat, Tabelle oder Code. */
export function parseHandbookPage(doc: string, markdown: string): HandbookPage {
  const lines = markdown.split('\n');
  const first = lines[0] ?? '';
  const title = first.startsWith('# ') ? first.slice(2).trim() : '';
  let i = 1;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  const paragraph: string[] = [];
  while (i < lines.length && lines[i]!.trim() !== '') paragraph.push(lines[i++]!);
  const head = paragraph[0] ?? '';
  const isParagraph = head !== '' && !/^(#|!\[|[-*+] |\d+\. |>|```|\||<)/.test(head);
  return { doc, title, lead: isParagraph ? paragraph.join('\n').trim() : '', body: lines.slice(1).join('\n').trim() };
}

export function readHandbookPage(env: Env, doc: string): HandbookPage | null {
  if (!DOC.test(doc) || doc === 'inhalt') return null;
  const file = inside(handbookDir(env), `${doc}.md`);
  if (!file || !existsSync(file)) return null;
  return parseHandbookPage(doc, readFileSync(file, 'utf8'));
}

export function readHandbookIndex(env: Env): string {
  const file = path.join(handbookDir(env), 'inhalt.md');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/**
 * Die verschachtelte Liste aus `inhalt.md`: oberste Ebene ist ein Kapitel —
 * mit Link ist es zugleich seine einzige Seite —, eingerückte Einträge sind
 * seine Seiten.
 */
export function parseHandbookIndex(markdown: string): HandbookChapter[] {
  const chapters: HandbookChapter[] = [];
  for (const raw of markdown.split('\n')) {
    const m = /^(\s*)[-*]\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const depth = m[1]!.length;
    const link = LINK.exec(m[2]!);
    const page = link ? { doc: link[2]!.replace(/\.md$/, ''), title: link[1]! } : null;
    if (depth === 0) chapters.push({ title: page ? page.title : m[2]!, pages: page ? [page] : [] });
    else if (page && chapters.length > 0) chapters.at(-1)!.pages.push(page);
  }
  return chapters;
}

/** `rel` ist der Pfad unterhalb von `bilder/`, wie er in `/help-bilder/<rel>` steht. */
export function readHandbookAsset(env: Env, rel: string): { bytes: Uint8Array; mimeType: string } | null {
  const ext = path.extname(rel).slice(1).toLowerCase();
  const mimeType = MIME[ext];
  if (!mimeType) return null;
  const root = path.join(handbookDir(env), 'bilder');
  const file = inside(root, rel);
  if (!file || file === path.resolve(root) || !existsSync(file)) return null;
  return { bytes: new Uint8Array(readFileSync(file)), mimeType };
}

export function listHandbookDocs(env: Env): string[] {
  const root = handbookDir(env);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === 'bilder' ? [] : walk(full);
      return name.endsWith('.md') ? [path.relative(root, full).replace(/\\/g, '/').replace(/\.md$/, '')] : [];
    });
  return existsSync(root) ? walk(root).filter((doc) => doc !== 'inhalt') : [];
}
```

In `packages/core/src/index.ts` nach `export * from './app';`:

```ts
export * from './help/handbook';
```

- [x] **Step 6: Grün und Typecheck**

Run: `cd packages/core && npx vitest run tests/handbook.test.ts tests/app.test.ts && cd ../.. && pnpm typecheck`
Expected: PASS, kein Typfehler.

- [x] **Step 7: Commit**

```bash
git add packages/core/src/app.ts packages/core/src/modules/manifest.ts packages/core/src/help/handbook.ts packages/core/src/index.ts packages/core/tests/handbook.test.ts packages/core/tests/fixtures/handbuch
git commit -m "feat(core): the core reads the handbook — pages with a lead paragraph, the index as chapters, images below bilder/"
```

---

### Task 2: Renderer für das Handbuch

**Files:**
- Create: `packages/markdown/src/help.ts`
- Modify: `packages/markdown/src/index.ts`
- Test: `packages/markdown/tests/help.test.ts`

**Interfaces:**
- Produces: `export async function renderHandbook(markdown: string, options: { doc: string }): Promise<string>` — `doc` ist der Pfad der Seite (`'akte/post-ablegen'`, `'inhalt'` für das Verzeichnis); relative Bild- und `.md`-Links werden gegen sein Verzeichnis aufgelöst.

- [x] **Step 1: Tests schreiben**

`packages/markdown/tests/help.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderHandbook } from '../src';

describe('renderHandbook', () => {
  it('keeps relative images and rewrites them to /help-bilder', async () => {
    const html = await renderHandbook('![Der Eingang](../bilder/akte/eingang.png)', { doc: 'akte/post-ablegen' });
    expect(html).toContain('<img src="/help-bilder/akte/eingang.png" alt="Der Eingang">');
  });

  it('drops images with a protocol or a path that leaves the handbook', async () => {
    expect(await renderHandbook('![x](https://example.org/x.png)', { doc: 'akte/post-ablegen' })).not.toContain('<img');
    expect(await renderHandbook('![x](../../etc/x.png)', { doc: 'akte/post-ablegen' })).not.toContain('<img');
  });

  it('rewrites links to other pages and keeps anchors and external links', async () => {
    const html = await renderHandbook('[Kontakte](../kontakte.md) [Abschnitt](#absaetze) [Astro](https://astro.build)', { doc: 'akte/post-ablegen' });
    expect(html).toContain('href="/help/kontakte"');
    expect(html).toContain('href="#absaetze"');
    expect(html).toContain('href="https://astro.build" rel="noopener"');
    expect(await renderHandbook('[Post](akte/post-ablegen.md)', { doc: 'inhalt' })).toContain('href="/help/akte/post-ablegen"');
  });

  it('shifts headings one level down and gives them ids', async () => {
    const html = await renderHandbook('# Titel\n\n## Absätze und Umbrüche\n\n### Tief', { doc: 'x' });
    expect(html).toContain('<h2 id="titel">Titel</h2>');
    expect(html).toContain('<h3 id="absaetze-und-umbrueche">Absätze und Umbrüche</h3>');
    expect(html).toContain('<h4 id="tief">Tief</h4>');
    expect(html).not.toContain('<h1');
  });

  it('still strips scripts and keeps the kompass directives', async () => {
    expect(await renderHandbook('<script>alert(1)</script>Text', { doc: 'x' })).not.toContain('script');
    expect(await renderHandbook('> Vorsicht', { doc: 'x' })).toContain('class="note"');
  });
});
```

- [x] **Step 2: Rot**

Run: `cd packages/markdown && npx vitest run tests/help.test.ts`
Expected: FAIL — `renderHandbook` fehlt.

- [x] **Step 3: `help.ts`**

`packages/markdown/src/help.ts`:

```ts
import path from 'node:path';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { Root as HastRoot, Element, Text } from 'hast';
import type { Schema } from 'hast-util-sanitize';
import { kompassConventions, literalUnknownDirectives } from './directives';
import { schema } from './sanitize';

/** Wie das Brief-Schema, plus Bilder (nur relativ), tiefere Überschriften und `id` für Anker. */
const handbookSchema: Schema = {
  ...schema,
  tagNames: [...(schema.tagNames ?? []), 'img', 'h5', 'h6'],
  attributes: { ...schema.attributes, img: ['src', 'alt'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'] },
  protocols: { ...schema.protocols, src: [] },
  strip: ['script', 'style', 'iframe'],
};

const HAS_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

/** `../bilder/akte/x.png` von `akte/post-ablegen` aus → `bilder/akte/x.png`; null, wenn es hinausführt. */
function resolveRelative(doc: string, href: string): string | null {
  const dir = path.posix.dirname(doc);
  const joined = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, href));
  return joined.startsWith('../') || joined === '..' || path.posix.isAbsolute(joined) ? null : joined;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function textOf(node: Element): string {
  let out = '';
  visit(node, 'text', (t: Text) => { out += t.value; });
  return out;
}

function handbookLinks(doc: string) {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName === 'img') {
        const src = typeof node.properties?.src === 'string' ? node.properties.src : '';
        const rel = HAS_PROTOCOL.test(src) || src.startsWith('/') ? null : resolveRelative(doc, src);
        if (!rel || !rel.startsWith('bilder/')) {
          if (parent && typeof index === 'number') parent.children.splice(index, 1);
          return index ?? undefined;
        }
        node.properties.src = `/help-bilder/${rel.slice('bilder/'.length)}`;
        return undefined;
      }
      if (node.tagName === 'a' && typeof node.properties?.href === 'string') {
        const href = node.properties.href;
        if (/^https?:\/\//.test(href)) node.properties.rel = ['noopener'];
        else if (!href.startsWith('#') && !HAS_PROTOCOL.test(href) && !href.startsWith('/')) {
          const [file, anchor] = href.split('#');
          const rel = file ? resolveRelative(doc, file) : null;
          if (rel && rel.endsWith('.md')) node.properties.href = `/help/${rel.slice(0, -3)}${anchor ? `#${anchor}` : ''}`;
        }
      }
      if (/^h[1-5]$/.test(node.tagName)) {
        node.tagName = `h${Number(node.tagName[1]) + 1}`;
        node.properties = { ...node.properties, id: slug(textOf(node)) };
      }
      return undefined;
    });
  };
}

/**
 * Das Handbuch in der App: Bilder aus `bilder/`, Links zwischen Seiten, und
 * alle Überschriften eine Stufe tiefer — das einzige `<h1>` bleibt die
 * Brotkrume der Schale.
 */
export async function renderHandbook(markdown: string, options: { doc: string }): Promise<string> {
  if (markdown.trim().length === 0) return '';
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(literalUnknownDirectives)
    .use(kompassConventions)
    .use(remarkRehype)
    .use(handbookLinks, options.doc)
    .use(rehypeSanitize, handbookSchema)
    .use(rehypeStringify)
    .process(markdown);
  return String(file).trim();
}
```

In `packages/markdown/src/index.ts`:

```ts
export { renderHandbook } from './help';
```

Hinweis: `h6` wird nicht weiter verschoben (Regex `h[1-5]`); ein `######` im Handbuch bleibt `h6`.

- [x] **Step 4: Grün und Typecheck**

Run: `cd packages/markdown && npx vitest run && cd ../.. && pnpm typecheck`
Expected: alle PASS (auch `render.test.ts`, das Brief-Schema ist unverändert), kein Typfehler.

- [x] **Step 5: Commit**

```bash
git add packages/markdown/src/help.ts packages/markdown/src/index.ts packages/markdown/tests/help.test.ts
git commit -m "feat(markdown): renderHandbook() — images from bilder/, links between pages, headings one level down with ids"
```

---

### Task 3: Zuordnung in der App und in den Manifesten

**Files:**
- Create: `apps/kompass/src/lib/help.ts`
- Modify: `apps/kompass/src/lib/navigation.ts` (`matches` exportieren; `crumbsFor` mit `helpChapters`)
- Modify: `packages/modules/{site,projects,animals,contacts,dms}/src/manifest.ts` (`help`)
- Test: `apps/kompass/tests/help.test.ts`, `apps/kompass/tests/navigation.test.ts`

**Interfaces:**
- Consumes: `HelpEntry`, `HandbookChapter` aus `@kompass/core`; `matches` aus `./navigation`.
- Produces:
  ```ts
  export const CORE_HELP: HelpEntry[]
  export function helpEntries(manifests: readonly ModuleManifest[], enabledKeys: ReadonlySet<string>): HelpEntry[]
  export function helpDocFor(entries: HelpEntry[], pathname: string): string | null
  // navigation.ts:
  export function matches(href: string, pathname: string): boolean
  export function crumbsFor(groups, pathname, t, helpChapters?: HandbookChapter[]): string[]
  ```

- [x] **Step 1: Tests schreiben**

`apps/kompass/tests/help.test.ts`:

```ts
import { coreModule, defineModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { CORE_HELP, helpDocFor, helpEntries } from '@/lib/help';

const dms = defineModule({
  key: 'dms',
  version: '0.1.0',
  permissions: ['dms.view'],
  navigation: [{ key: 'dms.list', href: '/dms', icon: 'file', group: 'dms', permission: 'dms.view' }],
  help: [
    { href: '/dms', doc: 'akte/dokumente-und-ordner' },
    { href: '/dms/receive', doc: 'akte/post-ablegen' },
  ],
});

describe('helpDocFor', () => {
  const entries = helpEntries([coreModule, dms], new Set(['core', 'dms']));

  it('prefers the longest matching route and falls back along the path', () => {
    expect(helpDocFor(entries, '/dms/receive')).toBe('akte/post-ablegen');
    expect(helpDocFor(entries, '/dms/01JABC')).toBe('akte/dokumente-und-ordner');
    expect(helpDocFor(entries, '/dmsx')).toBeNull();
  });

  it('knows the core pages and the home page', () => {
    expect(helpDocFor(entries, '/')).toBe('startseite');
    expect(helpDocFor(entries, '/admin/themes')).toBe('einstellungen/themes');
    expect(helpDocFor(entries, '/admin/media')).toBe('mediathek');
  });

  it('contributes nothing for a module that is switched off, and nothing on the help pages', () => {
    const off = helpEntries([coreModule, dms], new Set(['core']));
    expect(helpDocFor(off, '/dms/receive')).toBeNull();
    expect(off).toEqual(CORE_HELP);
    expect(helpDocFor(entries, '/help/akte/post-ablegen')).toBeNull();
    expect(helpDocFor(entries, '/help')).toBeNull();
  });
});
```

In `apps/kompass/tests/navigation.test.ts`, im `describe('crumbsFor', …)`, den Import `type HandbookChapter` aus `@kompass/core` ergänzen und einfügen:

```ts
  const chapters: HandbookChapter[] = [
    { title: 'Akte', pages: [{ doc: 'akte/post-ablegen', title: 'Post ablegen' }] },
    { title: 'Mediathek', pages: [{ doc: 'mediathek', title: 'Mediathek' }] },
  ];

  it('names help pages by chapter and title, collapsing a chapter that is its own page', () => {
    const th = (key: string) => (key === 'nav.help' ? 'Hilfe' : t(key));
    expect(crumbsFor(FIXTURE, '/help', th, chapters)).toEqual(['Hilfe']);
    expect(crumbsFor(FIXTURE, '/help/akte/post-ablegen', th, chapters)).toEqual(['Hilfe', 'Akte', 'Post ablegen']);
    expect(crumbsFor(FIXTURE, '/help/mediathek', th, chapters)).toEqual(['Hilfe', 'Mediathek']);
    expect(crumbsFor(FIXTURE, '/help/gibt-es-nicht', th, chapters)).toEqual(['Hilfe']);
  });
```

- [x] **Step 2: Rot**

Run: `cd apps/kompass && npx vitest run tests/help.test.ts tests/navigation.test.ts`
Expected: FAIL — `@/lib/help` fehlt, `crumbsFor` kennt `/help` nicht.

- [x] **Step 3: `matches` exportieren und `crumbsFor` erweitern**

In `apps/kompass/src/lib/navigation.ts`: `function matches(` → `export function matches(`. Import ergänzen: `import type { HandbookChapter, ModuleManifest, NavigationItem } from '@kompass/core';`. `crumbsFor` ersetzen:

```ts
/**
 * Die Brotkrume der Kopfleiste. Das letzte Segment ist das `<h1>` der Seite.
 * Heißen Modul und Seite gleich (Kontakte / Kontakte), bleibt ein Segment.
 * Unter `/help` kommen Kapitel und Titel aus dem Inhaltsverzeichnis.
 */
export function crumbsFor(groups: NavGroup[], pathname: string, t: (key: string) => string, helpChapters: HandbookChapter[] = []): string[] {
  if (pathname === '/') return [t('nav.home')];
  if (matches('/profile', pathname)) return [t('nav.profile')];
  if (matches('/help', pathname)) {
    const doc = pathname.slice('/help/'.length);
    for (const chapter of helpChapters) {
      const page = chapter.pages.find((p) => p.doc === doc);
      if (page) return page.title === chapter.title ? [t('nav.help'), page.title] : [t('nav.help'), chapter.title, page.title];
    }
    return [t('nav.help')];
  }
  const hit = locate(groups, pathname);
  if (!hit) return [];
  const page = hit.item.label ?? t(hit.item.labelKey);
  const area = t(hit.group.labelKey);
  if (hit.area === 'settings') return [t('nav.settingsArea'), area, page];
  return page === area ? [page] : [area, page];
}
```

- [x] **Step 4: `help.ts`**

`apps/kompass/src/lib/help.ts`:

```ts
import type { HelpEntry, ModuleManifest } from '@kompass/core';
import { matches } from './navigation';

/**
 * Die Hilfe der Kernseiten. Wie `CORE_ADMIN` in der Navigation: Der Kern
 * kennt keine Routen, die App ordnet zu.
 */
export const CORE_HELP: HelpEntry[] = [
  { href: '/', doc: 'startseite' },
  { href: '/profile', doc: 'profil' },
  { href: '/admin/media', doc: 'mediathek' },
  { href: '/admin/settings', doc: 'einstellungen/verein' },
  { href: '/admin/users', doc: 'einstellungen/nutzer-und-rollen' },
  { href: '/admin/roles', doc: 'einstellungen/nutzer-und-rollen' },
  { href: '/admin/audit', doc: 'einstellungen/aenderungsprotokoll' },
  { href: '/admin/retention', doc: 'einstellungen/aufbewahrung' },
  { href: '/admin/backup', doc: 'einstellungen/backup' },
  { href: '/admin/locales', doc: 'einstellungen/sprachen' },
  { href: '/admin/themes', doc: 'einstellungen/themes' },
  { href: '/admin/modules', doc: 'einstellungen/module' },
  { href: '/admin/documents', doc: 'einstellungen/dokumente' },
];

/** Kern plus die eingeschalteten Module — ein abgeschaltetes Modul hat keine Seiten, also keine Hilfe dazu. */
export function helpEntries(manifests: readonly ModuleManifest[], enabledKeys: ReadonlySet<string>): HelpEntry[] {
  return [...CORE_HELP, ...manifests.filter((m) => m.key !== 'core' && enabledKeys.has(m.key)).flatMap((m) => m.help ?? [])];
}

/** Die Handbuchseite zum Pfad: längster passender `href`; keine auf den Hilfeseiten selbst. */
export function helpDocFor(entries: HelpEntry[], pathname: string): string | null {
  if (matches('/help', pathname)) return null;
  let best: HelpEntry | null = null;
  for (const entry of entries) {
    if (!matches(entry.href, pathname)) continue;
    if (entry.href === '/' && pathname !== '/') continue;
    if (!best || entry.href.length > best.href.length) best = entry;
  }
  return best?.doc ?? null;
}
```

(`matches('/', '/x')` ist wahr, weil `'/x'.startsWith('//')` falsch, aber `pathname === href` … nein: `matches('/', '/x')` prüft `'/x'.startsWith('/' + '/')` → falsch und `'/x' === '/'` → falsch. Die Zeile mit `entry.href === '/'` ist also nur eine Absicherung, falls `matches` einmal die Wurzel anders behandelt; sie darf bleiben.)

- [x] **Step 5: Manifeste**

Je Manifest im `defineModule({ … })`-Objekt direkt nach `navigation: […]` (bei `dms` nach `adminNavigation`):

`packages/modules/site/src/manifest.ts`:
```ts
  help: [
    { href: '/site/template', doc: 'webseite/template-einlesen' },
    { href: '/site/variables', doc: 'webseite/variablen' },
    { href: '/site/c', doc: 'webseite/sammlungen' },
    { href: '/site/publish', doc: 'webseite/publizieren' },
  ],
```

`packages/modules/projects/src/manifest.ts`:
```ts
  help: [{ href: '/projects', doc: 'projekte' }],
```

`packages/modules/animals/src/manifest.ts`:
```ts
  help: [{ href: '/animals', doc: 'tiere' }],
```

`packages/modules/contacts/src/manifest.ts`:
```ts
  help: [{ href: '/contacts', doc: 'kontakte' }],
```

`packages/modules/dms/src/manifest.ts`:
```ts
  help: [
    { href: '/dms', doc: 'akte/dokumente-und-ordner' },
    { href: '/dms/receive', doc: 'akte/post-ablegen' },
    { href: '/dms/new', doc: 'akte/brief-schreiben' },
    { href: '/admin/dms', doc: 'einstellungen/akte-einrichten' },
  ],
```

- [x] **Step 6: Grün und Typecheck**

Run: `cd apps/kompass && npx vitest run tests/help.test.ts tests/navigation.test.ts && cd ../.. && pnpm typecheck`
Expected: PASS, kein Typfehler.

- [x] **Step 7: Commit**

```bash
git add apps/kompass/src/lib/help.ts apps/kompass/src/lib/navigation.ts apps/kompass/tests/help.test.ts apps/kompass/tests/navigation.test.ts packages/modules/site/src/manifest.ts packages/modules/projects/src/manifest.ts packages/modules/animals/src/manifest.ts packages/modules/contacts/src/manifest.ts packages/modules/dms/src/manifest.ts
git commit -m "feat(shell): every route knows its handbook page — core pages in the app, module pages in the manifests, longest match wins"
```

---

### Task 4: Vollständigkeitstest und Umzüge

**Files:**
- Test: `apps/kompass/tests/handbook-complete.test.ts` (neu)
- Move: `docs/betrieb.md` → `docs/handbuch/betrieb.md`; `docs/briefe-formatieren.md` → `docs/handbuch/akte/brief-schreiben.md`
- Modify: `packages/documents/tests/markdown-render.test.ts`, `apps/kompass/tests/german-quotes.test.ts`, `README.md`, `AGENTS.md`, `docs/nordstern.md`

**Interfaces:**
- Consumes: `listHandbookDocs`, `readHandbookPage`, `readHandbookIndex`, `parseHandbookIndex` (Task 1); `CORE_HELP` (Task 3); alle Manifeste aus `apps/kompass/src/modules.ts`.

Der Test ist am Ende dieses Tasks **rot** und wird in Task 5 grün — er ist die Abnahme für das Gerüst.

- [x] **Step 1: Test schreiben**

`apps/kompass/tests/handbook-complete.test.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { listHandbookDocs, parseHandbookIndex, readHandbookIndex, readHandbookPage } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { CORE_HELP } from '@/lib/help';
import { installedModules } from '@/modules';

/**
 * Das Handbuch ist Teil der Auslieferung. Eine Seite, die ein Manifest nennt,
 * muss existieren; eine Seite, die existiert, muss im Inhaltsverzeichnis
 * stehen; und jede beginnt mit Titel und Kurzabsatz — das Panel zeigt genau
 * den, und eine leere Hilfe ist schlimmer als keine.
 */
const env = { handbookDir: path.resolve(import.meta.dirname, '../../../docs/handbuch') };
const docs = listHandbookDocs(env);
const chapters = parseHandbookIndex(readHandbookIndex(env));
const indexed = chapters.flatMap((c) => c.pages);

describe('das Handbuch', () => {
  it('hat jede Seite, die eine Route nennt', () => {
    const named = [...CORE_HELP, ...installedModules.flatMap((m) => m.help ?? [])].map((h) => h.doc);
    expect(named.filter((doc) => !docs.includes(doc))).toEqual([]);
  });

  it('führt jede Seite genau einmal im Inhaltsverzeichnis, mit dem Titel der Datei', () => {
    const counts = new Map<string, number>();
    for (const page of indexed) counts.set(page.doc, (counts.get(page.doc) ?? 0) + 1);
    expect(docs.filter((doc) => counts.get(doc) !== 1)).toEqual([]);
    expect(indexed.filter((page) => !docs.includes(page.doc)).map((p) => p.doc)).toEqual([]);
    const wrongTitle = indexed.filter((page) => readHandbookPage(env, page.doc)?.title !== page.title).map((p) => p.doc);
    expect(wrongTitle).toEqual([]);
  });

  it('beginnt auf jeder Seite mit Titel und Kurzabsatz', () => {
    const broken = docs.filter((doc) => {
      const page = readHandbookPage(env, doc);
      return !page || page.title === '' || page.lead === '';
    });
    expect(broken).toEqual([]);
  });

  it('verweist nur auf Bilder und Seiten, die es gibt', () => {
    const missing: string[] = [];
    for (const doc of docs) {
      const body = readHandbookPage(env, doc)!.body;
      const dir = path.posix.dirname(doc);
      for (const [, target] of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|\[[^\]]*\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g).toArray().map((m) => [m[0], m[1] ?? m[2]] as const)) {
        if (!target) continue;
        const rel = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, target));
        if (!existsSync(path.join(env.handbookDir, rel))) missing.push(`${doc}: ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

Wenn `matchAll(...).toArray()` unter der Node-Version des Repos nicht existiert, stattdessen `[...body.matchAll(…)]` benutzen.

- [x] **Step 2: Rot**

Run: `cd apps/kompass && npx vitest run tests/handbook-complete.test.ts`
Expected: FAIL — `docs/handbuch` gibt es nicht; die genannten Seiten fehlen.

- [x] **Step 3: Umzüge**

```bash
mkdir -p docs/handbuch/akte
git mv docs/betrieb.md docs/handbuch/betrieb.md
git mv docs/briefe-formatieren.md docs/handbuch/akte/brief-schreiben.md
```

`docs/handbuch/betrieb.md`: Zeile 1 bleibt `# Betrieb auf dem QNAP TS-873`; direkt danach (vor `## Erstinstallation`) einfügen:

```markdown

Kompass läuft als ein Docker-Image auf dem NAS des Vereins, mit Test und Prod
als getrennten Anwendungen. Diese Seite beschreibt Erstinstallation, Update,
Backup und den Weg der Webseite vom NAS zum Webspace — für die Person, die
das NAS betreut.
```

`docs/handbuch/akte/brief-schreiben.md` umbauen: Die bisherige Datei wird der Abschnitt „Formatierungen". Mit `python3`:

```python
import pathlib, re
p = pathlib.Path('docs/handbuch/akte/brief-schreiben.md')
old = p.read_text()
assert old.startswith('# Briefe formatieren\n')
rest = old[len('# Briefe formatieren\n'):]
rest = re.sub(r'^(#{2,5}) ', lambda m: '#' + m.group(1) + ' ', rest, flags=re.M)   # ## → ###, ### → ####
head = """# Brief schreiben

Ein Brief entsteht als Entwurf: Empfänger aus den Kontakten, Betreff, Text —
rechts sehen Sie sofort, wie er auf dem Briefbogen aussieht. Bausteine fügen
wiederkehrende Absätze ein. Beim Festschreiben bekommt der Brief seine Nummer
und wird als PDF abgelegt; danach ändert sich nichts mehr daran.

## Entwurf

Über „Neuer Brief“ in der Akte öffnet sich der Entwurf als geteilter
Bildschirm: links die Felder, rechts die Vorschau. Der Empfänger kommt aus den
Kontakten — fehlt er, legen Sie ihn von hier aus an. Betreff und Text sind
Pflicht; Datum und Absender setzt Kompass aus den Vereinsdaten.

Ein Entwurf bleibt, bis Sie ihn festschreiben oder verwerfen. Verwerfen ist
die einzige Löschung in der Akte, und sie steht im Änderungsprotokoll.

## Bausteine

Wiederkehrende Absätze — Grußformel, Spendenhinweis, Bankverbindung — legen
Sie unter Einstellungen → Akte einrichten als Bausteine an. Im Entwurf fügt
„Baustein einfügen“ den Text an der Schreibmarke ein; danach ist er normaler
Text und lässt sich ändern.

## Formatierungen
"""
p.write_text(head + rest)
```

Danach prüfen, dass die Datei genau einen `# `-Titel hat (`grep -c '^# ' docs/handbuch/akte/brief-schreiben.md` → `1`) und der Block `<!-- beispielbrief -->` unverändert enthalten ist.

- [x] **Step 4: Verweise nachziehen**

`packages/documents/tests/markdown-render.test.ts`: die drei Vorkommen von `docs/briefe-formatieren.md` (Kommentar, `readFileSync`, Fehlertext) → `docs/handbuch/akte/brief-schreiben.md`.

`apps/kompass/tests/german-quotes.test.ts`: `const SCOPE = ['packages', 'apps', 'templates', 'scripts', 'docs/betrieb.md'];` → `const SCOPE = ['packages', 'apps', 'templates', 'scripts', 'docs/handbuch'];`

`README.md`: beide Links `docs/betrieb.md` → `docs/handbuch/betrieb.md`; im Abschnitt „Betrieb" den Satz ergänzen: „Das vollständige Handbuch liegt unter [`docs/handbuch/`](docs/handbuch/inhalt.md) und ist in der App über das „?" in der Kopfleiste erreichbar."

`AGENTS.md`: Zeile „Betrieb: `docs/betrieb.md` …" → `docs/handbuch/betrieb.md`; Zeile „Hilfeseite für die schreibende Person: `docs/briefe-formatieren.md` …" → `docs/handbuch/akte/brief-schreiben.md`; unter „Coding-Regeln" neuer Punkt:

```markdown
- Handbuch: Jede neue Seite der Oberfläche bringt ihre Handbuchseite unter `docs/handbuch/` und ihren `help`-Eintrag mit (Modul: im Manifest; Kern: `apps/kompass/src/lib/help.ts`). Eine Seite beginnt mit `# Titel` und einem Kurzabsatz; `apps/kompass/tests/handbook-complete.test.ts` prüft Vollständigkeit und Form. Spec: `2026-09-14-handbuch-und-hilfe-design.md`.
```

`docs/nordstern.md`, Säule Betrieb: `Quellen: \`docs/betrieb.md\`, …` → `docs/handbuch/betrieb.md`.

- [x] **Step 5: Bestehende Tests grün**

Run: `cd packages/documents && npx vitest run tests/markdown-render.test.ts && cd ../../apps/kompass && npx vitest run tests/german-quotes.test.ts`
Expected: beide PASS. Findet `german-quotes` in `betrieb.md` oder `brief-schreiben.md` gerade Anführungszeichen, die es vorher nicht prüfte (in `brief-schreiben.md` war die Datei bisher nicht im Scope): die Stellen auf „…“ umstellen — **außer** innerhalb von Code-Blöcken und dem `<!-- beispielbrief -->`-Block; dort sind sie Teil des Beispiels. Sollte der Test einen Codeblock anschlagen, den Befund hier notieren und die Regel des Tests lesen, bevor etwas geändert wird.

- [x] **Step 6: Commit**

```bash
git add apps/kompass/tests/handbook-complete.test.ts docs/handbuch/betrieb.md docs/handbuch/akte/brief-schreiben.md packages/documents/tests/markdown-render.test.ts apps/kompass/tests/german-quotes.test.ts README.md AGENTS.md docs/nordstern.md
git commit -m "docs(handbuch): betrieb and brief-schreiben move into the handbook; a test demands every routed page, indexed once, with title and lead"
```

(`git mv` ist bereits gestaged; der Commit nimmt die Umbenennungen mit.)

---

### Task 5: Das Gerüst — Inhaltsverzeichnis und alle Seiten

**Files:**
- Create: `docs/handbuch/inhalt.md` und alle Seiten unten; `docs/handbuch/bilder/einstieg/oberflaeche.png` (Platzhalter)
- Test: `apps/kompass/tests/handbook-complete.test.ts` (aus Task 4, wird grün)

Die Kurzabsätze stehen hier wörtlich und werden **unverändert** übernommen. Drei Seiten sind vollständig (`einstieg/oberflaeche`, `akte/post-ablegen`, `akte/brief-schreiben` — letztere aus Task 4). Alle anderen bestehen aus Titel und Kurzabsatz; Plan 2 füllt sie.

- [x] **Step 1: Inhaltsverzeichnis**

`docs/handbuch/inhalt.md`:

```markdown
- Einstieg
  - [Der erste Start](einstieg/erster-start.md)
  - [Anmelden](einstieg/anmelden.md)
  - [Die Oberfläche](einstieg/oberflaeche.md)
- [Startseite](startseite.md)
- Webseite
  - [Template einlesen](webseite/template-einlesen.md)
  - [Variablen](webseite/variablen.md)
  - [Sammlungen](webseite/sammlungen.md)
  - [Publizieren](webseite/publizieren.md)
  - [Ein Template schreiben](webseite/template-schreiben.md)
- [Projekte](projekte.md)
- [Tiere](tiere.md)
- [Kontakte](kontakte.md)
- Akte
  - [Dokumente und Ordner](akte/dokumente-und-ordner.md)
  - [Post ablegen](akte/post-ablegen.md)
  - [Brief schreiben](akte/brief-schreiben.md)
  - [Festschreiben und Versand](akte/festschreiben-und-versand.md)
  - [Bezüge und Wiedervorlage](akte/bezuege-und-wiedervorlage.md)
  - [Volltext](akte/volltext.md)
- [Mediathek](mediathek.md)
- Einstellungen
  - [Verein](einstellungen/verein.md)
  - [Nutzer und Rollen](einstellungen/nutzer-und-rollen.md)
  - [Änderungsprotokoll](einstellungen/aenderungsprotokoll.md)
  - [Aufbewahrung](einstellungen/aufbewahrung.md)
  - [Backup](einstellungen/backup.md)
  - [Sprachen](einstellungen/sprachen.md)
  - [Themes](einstellungen/themes.md)
  - [Module](einstellungen/module.md)
  - [Dokumente](einstellungen/dokumente.md)
  - [Akte einrichten](einstellungen/akte-einrichten.md)
- [Profil](profil.md)
- [Betrieb auf dem QNAP TS-873](betrieb.md)
```

- [x] **Step 2: Die drei vollständigen Seiten**

`docs/handbuch/einstieg/oberflaeche.md`:

```markdown
# Die Oberfläche

Links steht die Schiene mit einem Eintrag je Bereich — Startseite, Webseite,
Kontakte, Akte, Mediathek und unten die Einstellungen. Hat ein Bereich mehrere
Seiten, erscheint daneben eine zweite Spalte mit diesen Seiten. Oben läuft die
Kopfleiste mit Vereinsname, Brotkrume, Suche und Ihrem Nutzermenü.

![Die Oberfläche: Schiene, Zweitebene, Kopfleiste](../bilder/einstieg/oberflaeche.png)

## Die Schiene

Jeder Bereich ist eine Zeile mit Symbol und Wort. Die Schiene zeigt nur, was
Ihre Rolle sehen darf: Wer keine Rechte an der Akte hat, sieht die Akte
nicht. Ein Modul, das unter Einstellungen → Module ausgeschaltet ist, fehlt
ebenfalls.

Unten, hinter einer Linie, stehen die Einstellungen. Dort liegt alles, was
man einmal einrichtet und selten anfasst: Verein, Nutzer, Rollen, Themes,
Backup.

## Die Zweitebene

Steht ein Bereich auf mehr als einer Seite — die Webseite mit Template,
Variablen, Sammlungen und Publizieren, die Einstellungen mit ihren beiden
Abschnitten —, erscheint neben der Schiene eine zweite Spalte. Die aktuelle
Seite ist darin hervorgehoben. Bei einem Bereich mit nur einer Seite entfällt
die Spalte, und der Inhalt beginnt direkt neben der Schiene.

## Die Kopfleiste

Die Brotkrume nennt Bereich und Seite, auf der Sie stehen. Das Suchfeld
öffnet die Befehlspalette — auch mit **⌘K** (Mac) oder **Strg+K**: Tippen Sie
den Namen einer Seite, einer Einstellung oder einer Handbuchseite, und Enter
bringt Sie hin. Das **?** öffnet die Hilfe zur aktuellen Seite; die Taste `?`
tut dasselbe. Rechts das Nutzermenü: Profil, dunkles Design, Zeilendichte,
Abmelden.

## Auf dem Tablet

Unter 1180 Pixel Breite verschwinden Schiene und Zweitebene, und ein
Menüknopf links in der Kopfleiste öffnet beide als Liste über dem Inhalt.
Tabellen behalten alle Spalten und lassen sich seitwärts schieben.
```

Platzhalterbild anlegen (ersetzt Joe durch einen Screenshot):

```bash
mkdir -p docs/handbuch/bilder/einstieg
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d > docs/handbuch/bilder/einstieg/oberflaeche.png
```

`docs/handbuch/akte/post-ablegen.md`:

```markdown
# Post ablegen

Eingehende Post kommt als PDF in die Akte: Ziehen Sie die Datei auf einen
Ordner der Ordnerspalte oder auf den Eingang, bestätigen Sie Art, Betreff und
Absender — und das Dokument hat seine Nummer, seinen Ordner und seine
Aufbewahrungsfrist. Was Sie nicht sofort einsortieren, wartet im Eingang.

## Die Ablage

Die Ordnerspalte links ist nicht nur ein Filter, sondern das Ziel: Während
Sie eine Datei über das Fenster ziehen, hebt sich jede Zeile als Ablagefläche
hervor. Lassen Sie die Datei auf einem Ordner los, öffnet sich der Dialog
„Post ablegen“ mit diesem Ordner. Lassen Sie sie auf „Eingang“ los, landet
sie ohne Ordner im Eingang. Mehrere PDFs auf einmal werden nacheinander
abgefragt; Dateien, die kein PDF sind, meldet Kompass und überspringt sie.

Ohne Drag-and-drop: „Post ablegen“ oben in der Liste öffnet denselben Dialog
mit einer Dateiauswahl.

## Der Dialog

- **Dokumentart** — Brief, Behördenschreiben, Vertrag, Rechnung, Protokoll
  oder was Sie unter Einstellungen → Akte einrichten angelegt haben. Die Art
  bestimmt Nummernkreis und Aufbewahrungsfrist.
- **Betreff** — kurz, wie im Briefkopf; danach wird gesucht.
- **Absender** — ein Kontakt. Fehlt er, legen Sie ihn aus dem Dialog heraus
  an.
- **Datum** — das Datum des Schreibens, nicht der Ablage.
- **Ordner** — vorbelegt aus dem Ziel, auf dem Sie die Datei losgelassen
  haben.

Die **Einsortierhilfe** schlägt Art und Ordner vor, sobald der Text der
Datei gelesen ist: nach den Regeln, die Sie unter Akte einrichten festgelegt
haben (etwa „Absender Finanzamt → Behördenschreiben, Ordner Steuern“). Ein
Vorschlag ist ein Vorschlag; Sie bestätigen oder ändern ihn.

## Der Eingang

Der Eingang sammelt, was noch keinen Ordner hat. Von dort ziehen Sie ein
Dokument später auf seinen Ordner oder öffnen es und setzen den Ordner in der
Detailansicht. Ein Dokument im Eingang ist bereits abgelegt und nummeriert —
es ist nur noch nicht einsortiert.

## Danach

Kompass liest den Text jedes PDFs im Hintergrund; hat eine Seite keinen Text,
erkennt die Texterkennung ihn. Sobald das geschehen ist, findet die Suche das
Dokument über seinen Inhalt — siehe [Volltext](volltext.md). Ein Dokument
antwortet auf ein anderes oder ersetzt es: [Bezüge und
Wiedervorlage](bezuege-und-wiedervorlage.md).
```

Der Agent gleicht die Feldnamen des Dialogs (Dokumentart, Betreff, Absender, Datum, Ordner) und die Knopfbeschriftung „Post ablegen" mit `apps/kompass/messages/de.json` unter `dms` ab; weicht eine Beschriftung ab, wird **das Wort** im Handbuch angepasst, nicht der Satz.

- [x] **Step 3: Alle übrigen Seiten — Titel und Kurzabsatz, wörtlich**

Je Datei genau dieser Inhalt (Titel, Leerzeile, Kurzabsatz, Zeilenumbruch am Ende):

`docs/handbuch/einstieg/erster-start.md`
```markdown
# Der erste Start

Beim ersten Aufruf richtet Kompass sich ein: Sie vergeben den Namen des
Vereins und legen die erste Administratorin oder den ersten Administrator an.
Diese Seite gibt es nur einmal; danach führt der Weg über die Anmeldung.
```

`docs/handbuch/einstieg/anmelden.md`
```markdown
# Anmelden

Sie melden sich mit E-Mail-Adresse und Passwort an. Ein neu angelegter Nutzer
bekommt ein Startpasswort, das nur einmal angezeigt wird, und muss es bei der
ersten Anmeldung durch ein eigenes ersetzen. Nach mehreren Fehlversuchen ist
die Anmeldung für eine Viertelstunde gesperrt.
```

`docs/handbuch/startseite.md`
```markdown
# Startseite

Die Startseite zeigt, was ansteht: fällige Wiedervorlagen und Fristen aus
allen Bereichen, und solange die Einrichtung des Vereins unvollständig ist,
welche Angaben noch fehlen. Sie ist der Ort, an dem der Tag beginnt.
```

`docs/handbuch/webseite/template-einlesen.md`
```markdown
# Template einlesen

Die Vereinsseite wird aus einem Template gebaut, das der Verein mitbringt.
Beim Einlesen prüft Kompass, welche Variablen und Sammlungen das Template
deklariert, zeigt Befunde an und übernimmt die Deklaration — erst danach
lassen sich Inhalte pflegen und publizieren.
```

`docs/handbuch/webseite/variablen.md`
```markdown
# Variablen

Variablen sind die einzelnen Angaben, die das Template auf der Seite zeigt:
ein Leitspruch, eine Telefonnummer, ein Schalter für ein Angebot, ein Bild
aus der Mediathek. Was es gibt und welchen Typ es hat, bestimmt das Template;
Sie füllen die Werte aus, je Sprache.
```

`docs/handbuch/webseite/sammlungen.md`
```markdown
# Sammlungen

Eine Sammlung ist eine Liste gleichartiger Einträge, die das Template
deklariert — Aktuelles, Team, Fragen und Antworten. Sie legen Einträge an,
ordnen sie und nehmen sie wieder heraus; jeder Eintrag hat die Felder, die das
Template dafür vorsieht.
```

`docs/handbuch/webseite/publizieren.md`
```markdown
# Publizieren

Publizieren baut die Seite aus Template und Inhalten und lädt die fertigen
Dateien auf den Webspace des Vereins. Vorher laufen Prüfungen — fehlende
Pflichtangaben, gesperrte Begriffe, veraltete Verweise —, und Sie sehen, was
sich gegenüber dem letzten Stand ändert. Publiziert wird nur aus der
Prod-Instanz.
```

`docs/handbuch/webseite/template-schreiben.md`
```markdown
# Ein Template schreiben

Ein Template ist eine Astro-Seite mit einer Datei `kompass.template.ts`, die
Kompass sagt, welche Variablen und Sammlungen es braucht und welche Sichten
der Module es zeigt. Diese Seite erklärt den Vertrag für die Person, die das
Template baut — Felder, Typen, Referenzen, Startinhalte.
```

`docs/handbuch/projekte.md`
```markdown
# Projekte

Ein Projekt ist ein Vorhaben des Vereins mit Name, Beschreibung, Bild und
einem Verweis nach außen, etwa auf eine Spendenplattform. Der öffentliche
Teil erscheint auf der Webseite; die Finanzseite eines Projekts kommt mit der
Säule Finanzen.
```

`docs/handbuch/tiere.md`
```markdown
# Tiere

Jedes Tier hat ein Profil: Name, Herkunft, Geschichte, Fotos aus der
Mediathek und die Angaben, die die Webseite zeigt. Das Profil ist der
öffentliche Teil; der ganze Weg eines Tieres von der Aufnahme bis zur
Nachkontrolle kommt mit der Vollstufe des Moduls.
```

`docs/handbuch/kontakte.md`
```markdown
# Kontakte

Ein Kontakt ist eine Person oder Organisation, mit der der Verein zu tun hat:
Empfänger und Absender von Post, Partner, Behörden, später Mitglieder und
Spender. Rollen gelten über die Zeit, und aus ihnen berechnet Kompass, wie
lange die Daten aufbewahrt werden müssen. Die Beziehungsakte zeigt alle
Dokumente zu einem Kontakt.
```

`docs/handbuch/akte/dokumente-und-ordner.md`
```markdown
# Dokumente und Ordner

Die Akte ist die Post des Vereins: jeder Brief, der hinausgeht, und jedes
Schreiben, das hereinkommt, als PDF mit Nummer, Art, Datum und Absender oder
Empfänger. Links die Ordner, rechts die Liste; ein Klick öffnet das Dokument
mit allem, was dazugehört.
```

`docs/handbuch/akte/festschreiben-und-versand.md`
```markdown
# Festschreiben und Versand

Festschreiben macht aus einem Entwurf ein Dokument: Es bekommt seine Nummer,
wird als PDF abgelegt und ändert sich von da an nicht mehr. Der
Versandvermerk hält fest, wann und auf welchem Weg es den Verein verlassen
hat. Ein Fehler wird nicht gelöscht, sondern storniert — und das stornierte
Dokument bleibt lesbar.
```

`docs/handbuch/akte/bezuege-und-wiedervorlage.md`
```markdown
# Bezüge und Wiedervorlage

Ein Dokument steht selten allein: Es antwortet auf ein anderes, ist die
unterschriebene Fassung eines Entwurfs oder ersetzt ein früheres. Bezüge
halten das fest, sodass ein Vorgang zusammenbleibt. Eine Wiedervorlage setzt
ein Datum, an dem das Dokument auf der Startseite wieder auftaucht — etwa
„Antwort erwartet bis“.
```

`docs/handbuch/akte/volltext.md`
```markdown
# Volltext

Die Suche in der Akte findet Dokumente über ihren Inhalt, nicht nur über
Betreff und Nummer. Dafür liest Kompass den Text jedes PDFs; Seiten, die nur
ein Bild sind, gehen durch die Texterkennung auf dem NAS. Nichts davon
verlässt das Gerät.
```

`docs/handbuch/mediathek.md`
```markdown
# Mediathek

Die Mediathek sammelt Bilder, PDFs und andere Dateien, die der Verein an
mehreren Stellen braucht: Tierfotos, Projektbilder, das Logo, Formulare zum
Herunterladen. Ordner halten Ordnung, die Vorschau zeigt Bilder, und jede
Datei nennt, wo sie verwendet wird — gelöscht wird nur, was nirgends mehr
gebraucht wird.
```

`docs/handbuch/einstellungen/verein.md`
```markdown
# Verein

Hier stehen die Stammdaten des Vereins: Name und Anschrift, Vorstand,
Registereintrag, Steuernummer und Finanzamt, Bankverbindung, Logo. Aus diesen
Angaben entstehen Briefköpfe, Zuwendungsbestätigungen und die Pflichtangaben
der Webseite — sie stehen nirgends ein zweites Mal.
```

`docs/handbuch/einstellungen/nutzer-und-rollen.md`
```markdown
# Nutzer und Rollen

Jede Person, die mit Kompass arbeitet, hat einen eigenen Zugang und eine oder
mehrere Rollen. Eine Rolle ist ein Bündel von Rechten, das Sie frei benennen
und zusammenstellen; die Rechte selbst sind fest. Wer ein Recht nicht hat,
sieht die Seite nicht — und jede Änderung an Nutzern und Rollen steht im
Änderungsprotokoll.
```

`docs/handbuch/einstellungen/aenderungsprotokoll.md`
```markdown
# Änderungsprotokoll

Jede schreibende Aktion in Kompass hinterlässt einen Eintrag: wer, wann, auf
welchem Weg und was sich geändert hat, mit Vorher und Nachher. Das Protokoll
lässt sich nicht bearbeiten und nicht löschen. Es ist die Grundlage dafür,
dass Kompass Rechenschaft ablegen kann.
```

`docs/handbuch/einstellungen/aufbewahrung.md`
```markdown
# Aufbewahrung

Personenbezogene Daten dürfen nicht ewig bleiben. Kompass berechnet aus
Rollen und Vorgängen, wann ein Kontakt zur Löschung fällig wird, und listet
die fälligen hier auf. Gelöscht wird nichts von allein: Ein Mensch bestätigt
jede Löschung, und die Bestätigung steht im Änderungsprotokoll.
```

`docs/handbuch/einstellungen/backup.md`
```markdown
# Backup

Ein Backup ist eine Datei mit allem, was Kompass weiß: Datenbank, Dateien,
Einstellungen. Sie laden es hier herunter und spielen es auf einer anderen
Instanz ein — etwa um Test mit dem Stand von Prod zu füllen. Vor jedem
Update des Containers gehört ein Backup gezogen.
```

`docs/handbuch/einstellungen/sprachen.md`
```markdown
# Sprachen

Die Webseite kann in mehreren Sprachen erscheinen. Hier legen Sie fest,
welche — die erste ist die Leitsprache, in der Inhalte entstehen. Was in einer
Sprache fehlt, zeigt die Übersetzungsliste; die Texte selbst pflegen Sie am
Tier, am Projekt oder in den Sammlungen.
```

`docs/handbuch/einstellungen/themes.md`
```markdown
# Themes

Ein Theme sind die Farben und Schriften von Kompass: Hell und Dunkel, die
Vereinsfarbe, Flächen und Linien. Das mitgelieferte Theme ist
schreibgeschützt; eine Kopie davon können Sie ändern, prüfen lassen, ob
Kontraste ausreichen, und aktivieren.
```

`docs/handbuch/einstellungen/module.md`
```markdown
# Module

Kompass besteht aus einem Kern und Modulen — Webseite, Kontakte, Akte,
Projekte, Tiere. Hier schalten Sie ein, was der Verein braucht. Ein
ausgeschaltetes Modul verschwindet aus der Navigation; seine Daten bleiben
erhalten und sind wieder da, sobald Sie es einschalten.
```

`docs/handbuch/einstellungen/dokumente.md`
```markdown
# Dokumente

Briefe und andere Dokumente entstehen aus Basis-Vorlagen: Briefbogen, Rand,
Schrift, Fußzeile. Kompass bringt Vorlagen mit; der Verein kann eigene daneben
legen. Hier sehen Sie, welche es gibt, und erzeugen ein Beispiel, um eine
Vorlage zu prüfen.
```

`docs/handbuch/einstellungen/akte-einrichten.md`
```markdown
# Akte einrichten

Hier bestimmen Sie, wie die Akte sortiert: die Dokumentarten mit
Nummernkreis und Aufbewahrungsfrist, die Ordner, die Einsortierregeln, die aus
Absender oder Text auf Art und Ordner schließen, und die Textbausteine für
Briefe. Was hier steht, erscheint beim Ablegen als Vorschlag.
```

`docs/handbuch/profil.md`
```markdown
# Profil

Ihr eigener Zugang: Passwort ändern und API-Tokens verwalten. Ein Token
verbindet einen KI-Assistenten über MCP mit Kompass — er kann dann dasselbe
wie Sie, mit denselben Rechten, und jede Aktion steht unter Ihrem Namen im
Änderungsprotokoll. Ein Token wird nur einmal angezeigt.
```

- [x] **Step 4: Vollständigkeitstest grün**

Run: `cd apps/kompass && npx vitest run tests/handbook-complete.test.ts tests/german-quotes.test.ts`
Expected: PASS. Meldet der Test einen Titel, der nicht mit `inhalt.md` übereinstimmt, ist ein Tippfehler in einer der beiden Stellen — beheben, nicht den Test lockern.

- [x] **Step 5: Commit**

```bash
git add docs/handbuch
git commit -m "docs(handbuch): the table of contents and every page of the current screens — title and lead paragraph, three of them complete"
```

---

### Task 6: Routen — Seite, Bilder, Panel-Daten

**Files:**
- Create: `apps/kompass/src/app/(shell)/help/[[...doc]]/page.tsx`
- Create: `apps/kompass/src/components/handbook-toc.tsx`
- Create: `apps/kompass/src/app/help-bilder/[...path]/route.ts`
- Create: `apps/kompass/src/app/api/help/route.ts`
- Modify: `apps/kompass/src/app/globals.css` (Bilder in `.prose-preview`)
- Modify: `apps/kompass/messages/de.json` (`nav.help`, `help.title`)

**Interfaces:**
- Consumes: `readHandbookPage`, `readHandbookIndex`, `parseHandbookIndex`, `readHandbookAsset` (Task 1); `renderHandbook` (Task 2); `helpEntries`, `helpDocFor` (Task 3); `getDeps`, `runtimeEnv` aus `@/lib/deps`; `optionalSession`, `requireSession` aus `@/lib/request-context`; `enabledManifests` aus `@kompass/core`.
- Produces: `GET /api/help?path=` → `{ doc, title, href, leadHtml }` oder `{ doc: null, indexHtml }`; `GET /help-bilder/<rel>`; Seite `/help[/<doc>]`.

- [x] **Step 1: Texte**

`apps/kompass/messages/de.json`: im Objekt `nav` nach `"sectionAria"`: `"help": "Hilfe",`. Auf oberster Ebene ein neues Objekt (alphabetisch passend, etwa nach `"home"`):

```json
  "help": {
    "title": "Handbuch",
    "toc": "Inhaltsverzeichnis"
  },
```

- [x] **Step 2: Inhaltsverzeichnis-Komponente**

`apps/kompass/src/components/handbook-toc.tsx`:

```tsx
import type { HandbookChapter } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Das Inhaltsverzeichnis des Handbuchs, links neben der Seite und als Seite `/help`. */
export async function HandbookToc({ chapters, current }: { chapters: HandbookChapter[]; current: string | null }) {
  const t = await getTranslations('help');
  return (
    <nav aria-label={t('toc')} className="flex flex-col gap-3 text-[14px]">
      {chapters.map((chapter) => {
        const single = chapter.pages.length === 1 && chapter.pages[0]!.title === chapter.title;
        return (
          <div key={chapter.title} className="flex flex-col gap-0.5">
            {single ? (
              <Link href={`/help/${chapter.pages[0]!.doc}`} aria-current={current === chapter.pages[0]!.doc ? 'page' : undefined} className={cn('rounded-md px-2 py-1 font-semibold hover:bg-hover', current === chapter.pages[0]!.doc && 'bg-selected text-selected-ink')}>
                {chapter.title}
              </Link>
            ) : (
              <>
                <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-[.09em] text-muted-ink">{chapter.title}</div>
                {chapter.pages.map((page) => (
                  <Link key={page.doc} href={`/help/${page.doc}`} aria-current={current === page.doc ? 'page' : undefined} className={cn('rounded-md px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink', current === page.doc && 'bg-selected font-semibold text-selected-ink')}>
                    {page.title}
                  </Link>
                ))}
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}
```

- [x] **Step 3: Die Seite**

`apps/kompass/src/app/(shell)/help/[[...doc]]/page.tsx`:

```tsx
import { parseHandbookIndex, readHandbookIndex, readHandbookPage } from '@kompass/core';
import { renderHandbook } from '@kompass/markdown';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { HandbookToc } from '@/components/handbook-toc';
import { runtimeEnv } from '@/lib/deps';
import { requireSession } from '@/lib/request-context';

export default async function HelpPage({ params }: { params: Promise<{ doc?: string[] }> }) {
  await requireSession();
  const t = await getTranslations('help');
  const env = runtimeEnv();
  const chapters = parseHandbookIndex(readHandbookIndex(env));
  const { doc: segments } = await params;
  const doc = segments?.join('/') ?? null;

  if (!doc) {
    return (
      <div className="mx-auto max-w-[72ch]">
        <h2 className="font-heading text-[22px]">{t('title')}</h2>
        <div className="mt-4">
          <HandbookToc chapters={chapters} current={null} />
        </div>
      </div>
    );
  }

  const page = readHandbookPage(env, doc);
  if (!page) notFound();
  const html = await renderHandbook(page.body, { doc });
  return (
    <div className="flex gap-8">
      <aside className="w-60 shrink-0">
        <HandbookToc chapters={chapters} current={doc} />
      </aside>
      <article className="prose-preview min-w-0 max-w-[72ch] flex-1">
        <h2 className="font-heading text-[22px]">{page.title}</h2>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  );
}
```

In `apps/kompass/src/app/globals.css`, im `.prose-preview`-Block nach der `a`-Regel:

```css
  .prose-preview img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--radius-md); margin: 0.5em 0 1em; }
  .prose-preview h2 { font-size: 22px; }
  .prose-preview h3 { font-size: 17px; margin-top: 1.4em; }
  .prose-preview h4 { font-size: 15px; }
```

Prüfe vorher, ob `.prose-preview h2`/`h3` schon eine Schriftgröße haben (`grep -n "prose-preview h" apps/kompass/src/app/globals.css`); wenn ja, die vorhandene Regel ergänzen statt eine zweite anzulegen.

- [x] **Step 4: Bilder-Route**

`apps/kompass/src/app/help-bilder/[...path]/route.ts`:

```ts
import { readHandbookAsset } from '@kompass/core';
import { runtimeEnv } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { path } = await ctx.params;
  const asset = readHandbookAsset(runtimeEnv(), path.join('/'));
  if (!asset) return new Response(null, { status: 404 });
  return new Response(Buffer.from(asset.bytes), {
    headers: {
      'content-type': asset.mimeType,
      'cache-control': 'private, max-age=3600',
      'content-length': String(asset.bytes.byteLength),
      // Wie /media: ein SVG ist ein Dokument; die Sandbox nimmt ihm die Rechte des Ursprungs.
      'content-security-policy': 'sandbox',
      'x-content-type-options': 'nosniff',
    },
  });
}
```

- [x] **Step 5: Panel-Daten**

`apps/kompass/src/app/api/help/route.ts`:

```ts
import { enabledManifests, parseHandbookIndex, readHandbookIndex, readHandbookPage } from '@kompass/core';
import { renderHandbook } from '@kompass/markdown';
import { NextResponse } from 'next/server';
import { getDeps, runtimeEnv } from '@/lib/deps';
import { helpDocFor, helpEntries } from '@/lib/help';
import { optionalSession } from '@/lib/request-context';

/** Was das Hilfe-Panel zur Seite unter `path` zeigt: den Kurzabsatz, oder ohne Treffer das Inhaltsverzeichnis. */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const pathname = new URL(request.url).searchParams.get('path') ?? '/';
  const deps = getDeps();
  const env = runtimeEnv();
  const entries = helpEntries(deps.registry.manifests, new Set(enabledManifests(deps).map((m) => m.key)));
  const doc = helpDocFor(entries, pathname);
  const page = doc ? readHandbookPage(env, doc) : null;
  if (page) {
    return NextResponse.json({ doc: page.doc, title: page.title, href: `/help/${page.doc}`, leadHtml: await renderHandbook(page.lead, { doc: page.doc }) });
  }
  const chapters = parseHandbookIndex(readHandbookIndex(env));
  const index = chapters
    .map((c) => (c.pages.length === 1 && c.pages[0]!.title === c.title ? `- [${c.title}](${c.pages[0]!.doc}.md)` : [`- ${c.title}`, ...c.pages.map((p) => `  - [${p.title}](${p.doc}.md)`)].join('\n')))
    .join('\n');
  return NextResponse.json({ doc: null, indexHtml: await renderHandbook(index, { doc: 'inhalt' }) });
}
```

- [x] **Step 6: Typecheck, Schlüsseltest, Handprobe**

Run: `pnpm typecheck && cd apps/kompass && npx vitest run tests/message-keys.test.ts tests/no-hardcoded-ui-text.test.ts`
Expected: ohne Fehler, PASS.

Dann `cd apps/kompass && pnpm dev` im Hintergrund starten, anmelden, `http://localhost:3000/help/akte/post-ablegen` aufrufen: Verzeichnis links, Text rechts, Links auf `/help/akte/volltext` funktionieren; `http://localhost:3000/api/help?path=/dms/receive` liefert JSON mit `leadHtml`. Dev-Server danach beenden. (Die E2E dafür kommen in Task 8; die Handprobe ist nur, um nicht blind in Task 7 zu laufen.)

- [x] **Step 7: Commit**

```bash
git add "apps/kompass/src/app/(shell)/help" apps/kompass/src/components/handbook-toc.tsx apps/kompass/src/app/help-bilder apps/kompass/src/app/api/help apps/kompass/src/app/globals.css apps/kompass/messages/de.json
git commit -m "feat(shell): /help renders the handbook with its table of contents; /help-bilder serves the screenshots; /api/help answers the panel"
```

---

### Task 7: Panel, Knopf, Tastenkürzel, Palette

**Files:**
- Create: `apps/kompass/src/components/shell/help-panel.tsx`
- Modify: `apps/kompass/src/components/shell/topbar.tsx` (Knopf, Prop `onHelp`)
- Modify: `apps/kompass/src/components/shell/shell-frame.tsx` (Zustand, `?`, Panel, `helpChapters`)
- Modify: `apps/kompass/src/components/shell/command-palette.tsx` (Gruppe `help`, Prop `helpPages`)
- Modify: `apps/kompass/src/lib/command-index.ts` (Gruppe `help`)
- Modify: `apps/kompass/src/app/(shell)/layout.tsx` (Kapitel lesen, durchreichen)
- Modify: `apps/kompass/messages/de.json` (`shell.topbar.help`, `shell.help.*`, `palette.groups.help`)
- Test: `apps/kompass/tests/command-index.test.ts` (falls vorhanden — sonst neu)

**Interfaces:**
- Consumes: `HandbookChapter` aus `@kompass/core`; `crumbsFor(…, helpChapters)` (Task 3); `/api/help` (Task 6).
- Produces: `CommandEntry.group` um `'help'` erweitert; `buildCommandIndex({ …, helpPages: { doc; title; chapter }[] })`; `ShellFrame` bekommt `helpChapters: HandbookChapter[]`; `Topbar` bekommt `onHelp: () => void`.

- [x] **Step 1: Texte**

`de.json`: unter `shell.topbar` nach `"openNav"`: `"help": "Hilfe zu dieser Seite"`. Unter `shell` ein neues Objekt:

```json
    "help": {
      "readAll": "Ganze Seite lesen",
      "none": "Zu dieser Seite gibt es noch keine Hilfe.",
      "unavailable": "Die Hilfe ist gerade nicht erreichbar."
    },
```

Unter `palette.groups` nach `"actions"`: `"help": "Hilfe"`.

- [x] **Step 2: Test für den Paletten-Index**

Prüfe: `ls apps/kompass/tests/command-index.test.ts`. Existiert die Datei, den Fall anhängen; sonst anlegen:

```ts
import { describe, expect, it } from 'vitest';
import { buildCommandIndex } from '@/lib/command-index';

describe('buildCommandIndex', () => {
  it('lists handbook pages as the help group with their chapter as hint', () => {
    const entries = buildCommandIndex({
      groups: [],
      settingsFields: [],
      permissions: new Set(),
      helpPages: [{ doc: 'akte/post-ablegen', title: 'Post ablegen', chapter: 'Akte' }],
      t: (k) => k,
    });
    expect(entries).toEqual([{ id: 'help:akte/post-ablegen', group: 'help', label: 'Post ablegen', hint: 'Akte', href: '/help/akte/post-ablegen' }]);
  });
});
```

Run: `cd apps/kompass && npx vitest run tests/command-index.test.ts` → FAIL (`helpPages` unbekannt / Gruppe fehlt).

- [x] **Step 3: Index und Palette**

`apps/kompass/src/lib/command-index.ts`: `group: 'navigation' | 'settings' | 'actions'` → `group: 'navigation' | 'settings' | 'actions' | 'help'`. Im `input`-Typ: `helpPages?: { doc: string; title: string; chapter: string }[];`. Vor `return entries;`:

```ts
  for (const page of input.helpPages ?? []) {
    entries.push({ id: `help:${page.doc}`, group: 'help', label: page.title, hint: page.chapter, href: `/help/${page.doc}` });
  }
```

`apps/kompass/src/components/shell/command-palette.tsx`: Props um `helpPages: { doc: string; title: string; chapter: string }[]` erweitern, an `buildCommandIndex` durchreichen (`useMemo`-Abhängigkeiten ergänzen); `groupsOf`-Typ um `'help'`; die Render-Liste `(['navigation', 'settings'] as const)` → `(['navigation', 'settings', 'help'] as const)`.

- [x] **Step 4: Panel**

`apps/kompass/src/components/shell/help-panel.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

type Answer = { doc: string; title: string; href: string; leadHtml: string } | { doc: null; indexHtml: string };

/**
 * Die Hilfe zur aktuellen Seite: nur der Kurzabsatz, dann der Weg ins
 * Handbuch. Lädt beim Öffnen, damit die Schale nichts vom Handbuch wissen
 * muss und die Hilfe weichen Navigationen folgt.
 */
export function HelpPanel({ open, onOpenChange, pathname }: { open: boolean; onOpenChange: (open: boolean) => void; pathname: string }) {
  const t = useTranslations();
  const [state, setState] = useState<{ pathname: string; answer: Answer | 'error' } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/help?path=${encodeURIComponent(pathname)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Answer>) : Promise.reject(new Error(String(r.status)))))
      .then((answer) => { if (!cancelled) setState({ pathname, answer }); })
      .catch(() => { if (!cancelled) setState({ pathname, answer: 'error' }); });
    return () => { cancelled = true; };
  }, [open, pathname]);

  const current = state?.pathname === pathname ? state.answer : null;
  const title = current && current !== 'error' && current.doc ? current.title : t('help.title');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] gap-0 overflow-y-auto bg-surface p-6 shadow-md" data-testid="help-panel">
        <SheetTitle className="font-heading text-[19px]">{title}</SheetTitle>
        <div className="prose-preview mt-3 text-[14px]">
          {current === null ? (
            <div className="h-16 animate-pulse rounded-md bg-surface-2" aria-hidden />
          ) : current === 'error' ? (
            <p className="text-muted-ink">{t('shell.help.unavailable')}</p>
          ) : current.doc ? (
            <>
              <div dangerouslySetInnerHTML={{ __html: current.leadHtml }} />
              <Link href={current.href} onClick={() => onOpenChange(false)} className="mt-2 inline-block font-semibold text-link underline">
                {t('shell.help.readAll')}
              </Link>
            </>
          ) : (
            <>
              <p className="text-muted-ink">{t('shell.help.none')}</p>
              <div onClick={() => onOpenChange(false)} dangerouslySetInnerHTML={{ __html: current.indexHtml }} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

Prüfe, ob `text-link` als Token existiert (`grep -n "\-\-link\|text-link" apps/kompass/src/app/globals.css`); wenn nicht, die Klasse weglassen — `.prose-preview a` färbt Links ohnehin.

- [x] **Step 5: Topbar-Knopf**

In `topbar.tsx`: Import `import { CircleQuestionMark, Menu, Search } from 'lucide-react';`. Prop `onHelp: () => void` in `TopbarProps` und in der Destrukturierung. Zwischen dem Suchknopf und `<UserMenu …/>`:

```tsx
      <button type="button" onClick={onHelp} aria-label={t('shell.topbar.help')} className="flex size-[30px] shrink-0 items-center justify-center rounded-sm text-muted-ink hover:bg-hover hover:text-ink">
        <CircleQuestionMark className="size-[18px]" aria-hidden />
      </button>
```

- [x] **Step 6: ShellFrame**

In `shell-frame.tsx`:

- Import: `import type { HandbookChapter } from '@kompass/core';` und `import { HelpPanel } from './help-panel';`.
- Props um `helpChapters: HandbookChapter[]` und `helpPages: { doc: string; title: string; chapter: string }[]` erweitern.
- Zustand: `const [helpOpen, setHelpOpen] = useState(false);`
- `crumbs`: `useMemo(() => crumbsFor(groups, pathname, t, helpChapters), [groups, pathname, t, helpChapters])`.
- Tastenkürzel, als eigener `useEffect` nach dem `matchMedia`-Effekt:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable]') || target.isContentEditable)) return;
      e.preventDefault();
      setHelpOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
```

- `<Topbar …>` bekommt `onHelp={() => setHelpOpen(true)}`; `<CommandPalette groups={groups} permissions={permissions} helpPages={helpPages} />`; direkt nach `<CommandPalette …/>`: `<HelpPanel open={helpOpen} onOpenChange={setHelpOpen} pathname={pathname} />`.

- [x] **Step 7: Layout**

In `apps/kompass/src/app/(shell)/layout.tsx`: Import `parseHandbookIndex, readHandbookIndex` aus `@kompass/core`. Nach `const groups = …`:

```ts
  const helpChapters = parseHandbookIndex(readHandbookIndex(env));
  const helpPages = helpChapters.flatMap((c) => c.pages.map((p) => ({ doc: p.doc, title: p.title, chapter: c.title })));
```

Und an `<ShellFrame …>`: `helpChapters={helpChapters} helpPages={helpPages}`.

- [x] **Step 8: Grün, Typecheck, Schlüssel**

Run: `pnpm typecheck && cd apps/kompass && npx vitest run`
Expected: ohne Fehler, alle Unit-Tests PASS.

- [x] **Step 9: Commit**

```bash
git add apps/kompass/src/components/shell/help-panel.tsx apps/kompass/src/components/shell/topbar.tsx apps/kompass/src/components/shell/shell-frame.tsx apps/kompass/src/components/shell/command-palette.tsx apps/kompass/src/lib/command-index.ts "apps/kompass/src/app/(shell)/layout.tsx" apps/kompass/messages/de.json apps/kompass/tests/command-index.test.ts
git commit -m "feat(shell): the ? in the top bar opens the help panel with the page's lead paragraph; the command palette finds handbook pages"
```

---

### Task 8: Image und E2E, `pnpm verify`

**Files:**
- Modify: `Dockerfile` (ENV, COPY)
- Create: `apps/kompass/e2e/help.spec.ts`
- Modify: `docs/superpowers/plans/2026-09-14-handbuch-1-mechanik.md` (Häkchen)

- [x] **Step 1: E2E schreiben**

`apps/kompass/e2e/help.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('handbook and help', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('the panel shows the lead paragraph of the current page and leads into the handbook', async ({ page }) => {
    await page.goto('/dms/receive');
    await page.getByRole('button', { name: 'Hilfe zu dieser Seite' }).click();
    const panel = page.getByTestId('help-panel');
    await expect(panel.getByRole('heading', { name: 'Post ablegen' })).toBeVisible();
    await expect(panel).toContainText('Eingehende Post kommt als PDF in die Akte');
    await panel.getByRole('link', { name: 'Ganze Seite lesen' }).click();
    await expect(page).toHaveURL('/help/akte/post-ablegen');
    await expect(panel).toBeHidden();
    const toc = page.getByRole('navigation', { name: 'Inhaltsverzeichnis' });
    await expect(toc.getByRole('link', { name: 'Post ablegen' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Post ablegen');
    await expect(page.getByRole('banner')).toContainText('Hilfe');
    await expect(page.getByRole('banner')).toContainText('Akte');
  });

  test('the ? key opens the panel, but not inside a text field', async ({ page }) => {
    await page.goto('/contacts');
    await page.keyboard.press('Shift+?');
    await expect(page.getByTestId('help-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-panel')).toBeHidden();
    await page.getByRole('button', { name: 'Suchen' }).click();
    await page.getByRole('combobox').fill('?');
    await expect(page.getByTestId('help-panel')).toBeHidden();
    await page.keyboard.press('Escape');
  });

  test('images load and links between pages work', async ({ page }) => {
    await page.goto('/help/einstieg/oberflaeche');
    const image = page.getByRole('img', { name: 'Die Oberfläche: Schiene, Zweitebene, Kopfleiste' });
    await expect(image).toBeVisible();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await page.goto('/help/akte/post-ablegen');
    await page.getByRole('link', { name: 'Volltext' }).first().click();
    await expect(page).toHaveURL('/help/akte/volltext');
  });

  test('the table of contents, the palette and a page without help', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('navigation', { name: 'Inhaltsverzeichnis' }).getByRole('link', { name: 'Themes' })).toBeVisible();
    await page.getByRole('button', { name: 'Hilfe zu dieser Seite' }).click();
    const panel = page.getByTestId('help-panel');
    await expect(panel).toContainText('Zu dieser Seite gibt es noch keine Hilfe.');
    await expect(panel.getByRole('link', { name: 'Mediathek' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.locator('body[data-command-palette="ready"]')).toBeAttached();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
    await palette.getByRole('combobox').fill('Post ablegen');
    await expect(palette.getByText('Hilfe', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/help/akte/post-ablegen');
  });
});
```

Falls `page.keyboard.press('Shift+?')` das Zeichen nicht liefert, `page.keyboard.type('?')` verwenden. Der Suchknopf heißt „Suchen" (`shell.topbar.search`); trifft `getByRole('button', { name: 'Suchen' })` mehrere Elemente, `page.getByRole('banner').getByRole('button', { name: 'Suchen' })`.

- [x] **Step 2: E2E gegen `next dev`**

Run: `cd apps/kompass && npx playwright test e2e/help.spec.ts e2e/shell.spec.ts e2e/palette-and-errors.spec.ts`
Expected: alle PASS.

- [x] **Step 3: Dockerfile**

In `Dockerfile`, im `ENV`-Block des Runners nach `KOMPASS_TEMPLATES_DIR=/app/packages/documents/templates \`:

```dockerfile
    KOMPASS_HANDBOOK_DIR=/app/docs/handbuch \
```

Nach `COPY --from=build --chown=node:node /app/templates/verein-basis ./templates/verein-basis`:

```dockerfile
# Das Handbuch ist Teil der Auslieferung: die App rendert es als Hilfe.
COPY --from=build --chown=node:node /app/docs/handbuch ./docs/handbuch
```

- [x] **Step 4: `pnpm verify`**

Run: `pnpm verify` (Wurzel; Docker; ~4–5 Minuten, Timeout großzügig)
Expected: Typecheck, alle Tests, E2E kalt, Image, E2E gegen das Image — grün. Der Image-Ring beweist, dass `docs/handbuch` im Image liegt (Test „images load" lädt ein Bild daraus).

- [x] **Step 5: Commit**

```bash
git add Dockerfile apps/kompass/e2e/help.spec.ts
git commit -m "feat(image): the handbook ships in the image; e2e covers panel, ? key, images, links, table of contents and palette"
```

- [x] **Step 6: Plan abhaken und committen**

Alle `- [ ]` dieses Plans auf `- [x]`:

```bash
git add docs/superpowers/plans/2026-09-14-handbuch-1-mechanik.md
git commit -m "docs(plan): handbook plan 1 — mechanics and skeleton done, pnpm verify green"
```

Kein Push.

---

## Self-Review gegen die Spec

- **§ 3 Handbuch** → Task 5 (Verzeichnis, alle Seiten, Form) und Task 4 (Test der Form). **§ 4 Zuordnung** → Task 1 (`HelpEntry`, `help?`), Task 3 (`CORE_HELP`, Manifeste, `helpDocFor` über `matches`). **§ 5 Kern** → Task 1 (alle sechs Funktionen inkl. `parseHandbookIndex`, Pfadprüfung, `KOMPASS_HANDBOOK_DIR`). **§ 6 Renderer** → Task 2 (Bilder relativ, `.md`-Links, Überschriften tiefer mit `id`, Direktiven). **§ 7 Routen und Oberfläche** → Task 6 (Seite, `/help-bilder`, `/api/help` mit Sitzung), Task 7 (Panel, Knopf, `?` mit `contenteditable`, Palette-Gruppe, `crumbsFor`). **§ 8 Umzüge** → Task 4. **§ 9 Texte** → Tasks 6 und 7 (alle sieben Schlüssel; `help.toc` kommt als achter hinzu für das `aria-label` des Verzeichnisses — Abnahme § 14 letzter Punkt zählt „sieben aus § 9"; der Plan ergänzt ihn bewusst, weil ein `<nav>` einen Namen braucht). **§ 10 Tests** → Tasks 1, 2, 3, 4 (Unit), 8 (E2E, inkl. Image-Ring). **§ 11 Dateien** → alle genannt; `Dockerfile` in Task 8. **§ 13 Reihenfolge** → dieser Plan ist Schritt 1 mit drei vollständigen Seiten und Kurzabsätzen wörtlich.
- **Platzhalter:** keine. Die einzige Bedingung („falls `command-index.test.ts` existiert") nennt beide Wege mit Code.
- **Typen:** `HandbookChapter {title, pages[{doc,title}]}` (Task 1) = `crumbsFor` (3) = `HandbookToc` (6) = `ShellFrame.helpChapters` (7). `helpPages {doc,title,chapter}` (7) in `layout.tsx`, `ShellFrame`, `CommandPalette`, `buildCommandIndex` gleich. `Answer` im Panel (7) = JSON aus `/api/help` (6): `{doc,title,href,leadHtml}` bzw. `{doc:null,indexHtml}`. `readHandbookAsset(env, rel)` mit `rel` unter `bilder/` (1) = Route `/help-bilder/[...path]` (6) = Renderer-Ziel `/help-bilder/<rel>` (2).
