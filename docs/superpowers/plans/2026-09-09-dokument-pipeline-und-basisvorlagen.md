# Dokument-Pipeline und Basis-Vorlagen — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Module beschreiben Dokumentarten (Zod + Markdown), eine generische Pipeline wandelt das deterministisch nach Typst und setzt es in eine austauschbare Basis-Vorlage; vereinseigene Basis-Vorlagen kommen aus `/data/document-templates`.

**Architecture:** Zweistufig wie die Webseite. A) `DocumentTemplate.build(data, ctx) → { slots, body }` im Modul; `renderDocument` im Kern wandelt Markdown → Typst, wählt die Basis, kompiliert, nummeriert, friert ein. B) Basis-Vorlagen sind `.typ`-Dateien: mitgeliefert unter `packages/documents/templates/bases/`, überlagert vom Volume `KOMPASS_DOCUMENT_TEMPLATES_DIR`. Jedes Dokument hält `base` + `baseChecksum` im `inputSnapshot`.

**Tech Stack:** TypeScript, Typst 0.15.1 (Kindprozess), Vitest, unified/remark, Drizzle/SQLite, Next.js, Docker.

**Spec:** `docs/superpowers/specs/2026-09-09-dokument-pipeline-und-basisvorlagen-design.md`

## Global Constraints

- Determinismus ist Vertrag: gleiche Eingabe + Basis + Branding + Typst-Version ⇒ byte-identisches PDF. `build()` ist rein über `(data, ctx)` — keine Uhr, kein Zufall, kein I/O. `renderMarkdownTypst` ist rein. Jede Basis setzt `set document(date: none)` und nutzt **kein** `datetime.today()`.
- Nutzertext wird beim Wandeln nach Typst **escaped** (`#`, `[`, `]`, `\`, `*`, `_`, `$`, `@`, `` ` ``, `~`, `<`, `>`, `+`, `-` am Zeilenanfang) — er darf nie als Markup oder Code wirken.
- Typst-Aufruf über `compileTypst` (`--root <job>`, `--font-path <fonts>`, `--ignore-system-fonts`). Nur Schriften aus dem Repo (`packages/documents/fonts`). Datenübergabe als `data.json` unter dem Root (`json("/data.json")`), nicht `--input` (128-KB-Limit).
- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Fachfehler als `Result`, nie Exceptions. Dokument wird nie gelöscht, nur storniert.
- Kein statischer Farbwert im Anwendungscode; Basis-Vorlagen lesen `payload.brand.*` (aus dem aktiven Theme). Keine Vereinsspezifika im Produkt-Repo (`no-association-content.test.ts`).
- Code Englisch, Oberfläche über `apps/kompass/messages/de.json` (Sie-Form). Kommentare Deutsch bei Vereinsbezug.
- Pro Task ein Commit. `pnpm verify` erst im letzten Task, danach ein Push. Docker-CLI unter `/Applications/Docker.app/Contents/Resources/bin` (nicht im PATH).

## Dateien

| Datei | Zweck |
|---|---|
| `packages/markdown/src/typst.ts` (neu) | `renderMarkdownTypst` |
| `packages/markdown/src/index.ts` | Export |
| `packages/markdown/tests/typst.test.ts` (neu) | Wandlung + Escaping + Determinismus |
| `packages/documents/templates/bases/a4-plain.typ` (neu) | generische Basis, ohne Briefkopf |
| `packages/documents/templates/bases/a4-mit-briefkopf.typ` (neu) | Geschäftsbrief |
| `packages/documents/templates/bases/a4-ohne-briefkopf.typ` (neu) | Brief-Folgeblatt |
| `packages/documents/templates/bases/bases.json` (neu) | Labels/Art |
| `packages/documents/templates/base.typ` · `letterhead.typ` · `audit-log-export.typ` | **entfallen** |
| `packages/documents/src/bases.ts` (neu) | Auflösung, Prüfsumme, Prüf-Render |
| `packages/documents/src/renderer.ts` | `renderDocument({ baseId, bodyTypst, payload })`, Volume-Overlay |
| `packages/documents/src/templates.ts` | `letterhead`/`audit-log-export` als `build()`; `buildPayload` um `slots` + `primarySoft` |
| `packages/documents/src/index.ts` | Exporte (`resolveDocumentBases`, `listDocumentBases`) |
| `packages/documents/tests/*` | angepasst + neu |
| `packages/core/src/modules/manifest.ts` | `DocumentSlots`, `DocumentBody`, `DocumentBuildResult`, `DocumentTemplate` neu |
| `packages/core/src/documents/service.ts` | `renderDocument` neu, `listDocumentBases`, Basis-Auflösung |
| `packages/core/src/settings/core.ts` | `documents.bases` |
| `packages/core/tests/documents.test.ts` | angepasst |
| `packages/core/src/deps.ts` / `app.ts` | `documentBasesDir` an `createDeps` |
| `apps/kompass/src/lib/deps.ts` | Renderer + Bases-Verzeichnis übergeben |
| `apps/kompass/src/app/(shell)/admin/documents/*` | Abschnitt „Basis-Vorlagen", Dialog: Markdown-Hinweis |
| `apps/kompass/src/app/(shell)/admin/settings/*` | Abschnitt „Dokumente" (`documents.bases`) |
| `apps/kompass/messages/de.json` | `documents.*`, `settings.*` |
| `apps/kompass/e2e/documents.spec.ts` | Brief + Basis-Vorlagen-Abschnitt |
| `packages/mcp/src/core-tools.ts` | `documents_bases` (Liste) |
| `Dockerfile` | `KOMPASS_DOCUMENT_TEMPLATES_DIR` |
| `scripts/seed-document-templates.sh` (neu) · `scripts/docker-entrypoint.sh` | Erstinbetriebnahme |
| `apps/kompass/tests/entrypoint.test.ts` | Test für das neue Skript |
| `docs/betrieb.md` | Vertrauensgrenze `/data/document-templates` |

---

### Task 1: `renderMarkdownTypst` in `@kompass/markdown`

**Files:**
- Create: `packages/markdown/src/typst.ts`
- Modify: `packages/markdown/src/index.ts`
- Create: `packages/markdown/tests/typst.test.ts`

**Interfaces:**
- Produces: `renderMarkdownTypst(markdown: string): Promise<string>` — Typst-Content-Markup, deterministisch, Nutzertext escaped

- [ ] **Step 1: Test schreiben**

```ts
// packages/markdown/tests/typst.test.ts
import { describe, expect, it } from 'vitest';
import { renderMarkdownTypst } from '../src/typst';

describe('renderMarkdownTypst', () => {
  it('maps block elements to typst', async () => {
    const out = await renderMarkdownTypst('# Titel\n\nText mit *fett* und _kursiv_.\n\n- a\n- b\n\n> Hinweis\n\n---');
    expect(out).toContain('= Titel');
    expect(out).toContain('*fett*');
    expect(out).toContain('_kursiv_');
    expect(out).toContain('- a');
    expect(out).toContain('#quote(block: true)[');
    expect(out).toContain('#line(length: 100%');
  });

  it('renders a gfm table', async () => {
    const out = await renderMarkdownTypst('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('#table(');
    expect(out).toContain('columns: 2');
  });

  it('escapes typst-special characters in text so user content cannot inject', async () => {
    const out = await renderMarkdownTypst('Preis #panic("x") [box] $x^2$ @label \\ ~');
    expect(out).not.toContain('#panic');
    expect(out).toContain('\\#panic');
    expect(out).toContain('\\[box\\]');
    expect(out).toContain('\\$x^2\\$');
  });

  it('is deterministic', async () => {
    const md = '## Abschnitt\n\nEin Absatz mit [Link](https://example.org).';
    expect(await renderMarkdownTypst(md)).toBe(await renderMarkdownTypst(md));
  });

  it('returns empty string for blank input', async () => {
    expect(await renderMarkdownTypst('   \n')).toBe('');
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/markdown test typst`
Expected: FAIL — `Cannot find module '../src/typst'`

- [ ] **Step 3: `typst.ts` schreiben**

```ts
// packages/markdown/src/typst.ts
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Nodes, RootContent } from 'mdast';

/** Zeichen, die Typst als Markup/Code deutet — im Fließtext neutralisiert. */
const escapeText = (s: string): string => s.replace(/[\\#$\[\]*_`~@<>]/g, (c) => `\\${c}`);

function inline(nodes: RootContent[] | Nodes[] | undefined): string {
  if (!nodes) return '';
  return (nodes as Nodes[])
    .map((n): string => {
      switch (n.type) {
        case 'text': return escapeText(n.value);
        case 'strong': return `*${inline((n as any).children)}*`;
        case 'emphasis': return `_${inline((n as any).children)}_`;
        case 'inlineCode': return '`' + (n as any).value.replace(/`/g, '') + '`';
        case 'break': return ' \\\n';
        case 'delete': return `#strike[${inline((n as any).children)}]`;
        case 'link': {
          const url = String((n as any).url).replace(/[\\"]/g, '');
          return `#link("${url}")[${inline((n as any).children)}]`;
        }
        default: return escapeText((n as any).value ?? '');
      }
    })
    .join('');
}

function block(node: Nodes): string {
  switch (node.type) {
    case 'heading':
      return `${'='.repeat(node.depth)} ${inline(node.children)}\n`;
    case 'paragraph':
      return `${inline(node.children)}\n`;
    case 'thematicBreak':
      return `#line(length: 100%, stroke: 0.5pt + luma(70%))\n`;
    case 'blockquote':
      return `#quote(block: true)[${node.children.map(block).join('\n')}]\n`;
    case 'list': {
      const marker = node.ordered ? '+' : '-';
      return node.children
        .map((item: any) => `${marker} ${item.children.map(block).join(' ').trim()}`)
        .join('\n') + '\n';
    }
    case 'code':
      return '```\n' + node.value.replace(/`/g, '') + '\n```\n';
    case 'table': {
      const rows = node.children as any[];
      const cols = rows[0]?.children.length ?? 1;
      const cells = rows.flatMap((r) => r.children.map((c: any) => `[${inline(c.children)}]`));
      return `#table(\n  columns: ${cols},\n  ${cells.join(', ')}\n)\n`;
    }
    case 'containerDirective':
      if ((node as any).name === 'karten') {
        const inner = (node as any).children.map(block).join('\n');
        return `#grid(columns: 2, gutter: 1em, ${inner})\n`;
      }
      return (node as any).children.map(block).join('\n');
    default:
      return '';
  }
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);

export async function renderMarkdownTypst(markdown: string): Promise<string> {
  if (markdown.trim().length === 0) return '';
  const tree = parser.parse(markdown);
  const processed = await parser.run(tree);
  return (processed.children as Nodes[]).map(block).join('\n').trim();
}
```

Hinweis: `table` als flache Zellliste ist die einfachste deterministische Form; die Basis stylt Kopf/Zebra über `show table.cell`. Wenn `@types/mdast` die `any`-Casts ablehnt, die betroffenen Knoten schmal typisieren statt `any` — die Struktur steht in `mdast`.

- [ ] **Step 4: Export**

`packages/markdown/src/index.ts`:

```ts
export { renderMarkdown } from './render';
export { renderMarkdownTypst } from './typst';
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/markdown test && pnpm --filter @kompass/markdown typecheck`
Expected: grün

- [ ] **Step 6: Commit**

```bash
git add packages/markdown/src/typst.ts packages/markdown/src/index.ts packages/markdown/tests/typst.test.ts
git commit -m "feat(markdown): deterministic Markdown to Typst"
```

---

### Task 2: Basis-Vorlagen — Auflösung und Prüfung

**Files:**
- Create: `packages/documents/src/bases.ts`
- Modify: `packages/documents/src/renderer.ts` (nur `resolveAssetDirs` um `documentTemplatesDir`)
- Modify: `packages/documents/src/index.ts`
- Create: `packages/documents/tests/bases.test.ts`

**Interfaces:**
- Produces:
  - `resolveAssetDirs(env?)` → `{ templatesDir, fontsDir, documentTemplatesDir: string | null }`
  - `resolveBases(dirs): Map<string, { id; typst: string; checksum: string; label: string; kind: string }>` — mitgeliefert (`<templatesDir>/bases`) + Overlay (`documentTemplatesDir`), Overlay gewinnt
  - `probeBase(entry): Promise<{ ok: true } | { ok: false; error: string }>` — Prüf-Render mit Minimal-Payload

- [ ] **Step 1: Test schreiben**

```ts
// packages/documents/tests/bases.test.ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAssetDirs, resolveBases, probeBase } from '../src/bases';
import { createTypstRenderer } from '../src';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-bases-')); dirs.push(d); return d; };

describe('document bases', () => {
  it('resolves the shipped bases and reports their ids', () => {
    const bases = resolveBases(resolveAssetDirs({}));
    expect([...bases.keys()].sort()).toEqual(['a4-mit-briefkopf', 'a4-ohne-briefkopf', 'a4-plain']);
    expect(bases.get('a4-plain')!.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lets a volume base override a shipped one', () => {
    const vol = tmp();
    writeFileSync(path.join(vol, 'a4-plain.typ'), '#let base(payload, slots, body) = { set document(date: none); body }');
    const bases = resolveBases(resolveAssetDirs({ KOMPASS_DOCUMENT_TEMPLATES_DIR: vol }));
    expect(bases.get('a4-plain')!.typst).toContain('#let base(payload, slots, body)');
  });

  it('probes a base and reports a broken one', async () => {
    const good = await probeBase({ renderer: createTypstRenderer(), baseId: 'a4-plain', bases: resolveBases(resolveAssetDirs({})) });
    expect(good.ok).toBe(true);
    const vol = tmp();
    writeFileSync(path.join(vol, 'kaputt.typ'), '#let notbase() = 1');
    const bad = await probeBase({ renderer: createTypstRenderer(), baseId: 'kaputt', bases: resolveBases(resolveAssetDirs({ KOMPASS_DOCUMENT_TEMPLATES_DIR: vol })) });
    expect(bad.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/documents test bases`
Expected: FAIL — Modul fehlt / Basen fehlen (Task 3 liefert die `.typ`)

- [ ] **Step 3: `resolveAssetDirs` erweitern**

In `packages/documents/src/renderer.ts`:

```ts
export function resolveAssetDirs(env: Record<string, string | undefined> = process.env): {
  templatesDir: string;
  fontsDir: string;
  documentTemplatesDir: string | null;
} {
  return {
    templatesDir: env.KOMPASS_TEMPLATES_DIR ?? path.join(PACKAGE_DIR, 'templates'),
    fontsDir: env.KOMPASS_FONTS_DIR ?? path.join(PACKAGE_DIR, 'fonts'),
    documentTemplatesDir: env.KOMPASS_DOCUMENT_TEMPLATES_DIR ?? null,
  };
}
```

`renderer.test.ts` „honours KOMPASS_TEMPLATES_DIR…" anpassen: `toEqual({ templatesDir: '/srv/t', fontsDir: '/srv/f', documentTemplatesDir: null })`.

- [ ] **Step 4: `bases.ts` schreiben**

```ts
// packages/documents/src/bases.ts
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TypstRenderer } from './renderer';

const ID = /^[a-z][a-z0-9-]{1,40}$/;

export interface ResolvedBase {
  id: string;
  typst: string;
  checksum: string;
  label: string;
  kind: string;
}

function readManifest(dir: string): Record<string, { label?: string; kind?: string }> {
  const file = path.join(dir, 'bases.json');
  if (!existsSync(file)) return {};
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as { id: string; label?: string; kind?: string }[];
    return Object.fromEntries(list.map((b) => [b.id, { label: b.label, kind: b.kind }]));
  } catch {
    return {};
  }
}

function readDir(dir: string): Map<string, ResolvedBase> {
  const out = new Map<string, ResolvedBase>();
  if (!existsSync(dir)) return out;
  const manifest = readManifest(dir);
  for (const name of require('node:fs').readdirSync(dir)) {
    if (!name.endsWith('.typ')) continue;
    const id = name.slice(0, -4);
    if (!ID.test(id)) continue;
    const typst = readFileSync(path.join(dir, name), 'utf8');
    out.set(id, {
      id,
      typst,
      checksum: createHash('sha256').update(typst).digest('hex'),
      label: manifest[id]?.label ?? id,
      kind: manifest[id]?.kind ?? 'plain',
    });
  }
  return out;
}

/** Mitgeliefert (`<templatesDir>/bases`) plus Volume-Overlay; Overlay gewinnt je ID. */
export function resolveBases(dirs: { templatesDir: string; documentTemplatesDir: string | null }): Map<string, ResolvedBase> {
  const bases = readDir(path.join(dirs.templatesDir, 'bases'));
  if (dirs.documentTemplatesDir) {
    for (const [id, base] of readDir(dirs.documentTemplatesDir)) bases.set(id, base);
  }
  return bases;
}

const PROBE_PAYLOAD = {
  brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.city': 'Musterstadt' },
  logoFile: null,
  number: 'TST-2026-001',
  issuedDate: '01.01.2026',
  slots: { kind: 'plain', title: 'Prüfung' },
};

export async function probeBase(opts: { renderer: TypstRenderer; baseId: string; bases: Map<string, ResolvedBase> }): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = opts.bases.get(opts.baseId);
  if (!base) return { ok: false, error: 'not found' };
  try {
    await opts.renderer.renderDocument({ baseId: opts.baseId, bases: opts.bases, bodyTypst: 'Prüftext.', payload: PROBE_PAYLOAD });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

(Die `readDir`-Schleife nutzt `readdirSync` synchron, weil `resolveBases` synchron ist — der Aufrufer im Kern ruft es beim Start; `require('node:fs').readdirSync` durch einen `import { readdirSync } from 'node:fs'` ersetzen.)

- [ ] **Step 5: Export**

`packages/documents/src/index.ts` um `export * from './bases';` ergänzen.

- [ ] **Step 6: Test ausführen (nach Task 3 grün)**

Run: `pnpm --filter @kompass/documents test bases`
Expected: nach Task 3 grün; jetzt noch FAIL wegen fehlender `.typ`.

- [ ] **Step 7: Commit**

```bash
git add packages/documents/src/bases.ts packages/documents/src/renderer.ts packages/documents/src/index.ts packages/documents/tests/bases.test.ts packages/documents/tests/renderer.test.ts
git commit -m "feat(documents): resolve document base templates from ship + volume"
```

---

### Task 3: Die drei generischen Basen

**Files:**
- Create: `packages/documents/templates/bases/a4-plain.typ`, `a4-mit-briefkopf.typ`, `a4-ohne-briefkopf.typ`, `bases.json`
- Create: `packages/documents/tests/bases-render.test.ts`

**Interfaces:**
- Produces: drei `.typ`, jede exportiert `#let base(payload, slots, body)` mit `set document(date: none)`

- [ ] **Step 1: Test schreiben**

```ts
// packages/documents/tests/bases-render.test.ts
import { describe, expect, it } from 'vitest';
import { createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';

const bases = resolveBases(resolveAssetDirs({}));
const renderer = createTypstRenderer();
const payload = (over = {}) => ({
  brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.street': 'Musterweg 1', 'organization.postalCode': '12345', 'organization.city': 'Musterstadt' },
  logoFile: null, number: 'BRF-2026-001', issuedDate: '05.09.2026',
  slots: { kind: 'letter', title: 'Einladung', subject: 'Mitgliederversammlung', recipient: 'Max Mustermann\nWeg 1\n12345 Stadt' },
  ...over,
});

describe('generic bases render', () => {
  for (const id of ['a4-plain', 'a4-mit-briefkopf', 'a4-ohne-briefkopf']) {
    it(`${id} produces a PDF`, async () => {
      const pdf = await renderer.renderDocument({ baseId: id, bases, bodyTypst: 'Absatz eins.\n\nAbsatz zwei.', payload: payload() });
      expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    });
  }

  it('a4-mit-briefkopf renders deterministically', async () => {
    const a = await renderer.renderDocument({ baseId: 'a4-mit-briefkopf', bases, bodyTypst: 'Text.', payload: payload() });
    const b = await renderer.renderDocument({ baseId: 'a4-mit-briefkopf', bases, bodyTypst: 'Text.', payload: payload() });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/documents test bases-render`
Expected: FAIL — `renderer.renderDocument` fehlt (Task 4) / Basen fehlen

- [ ] **Step 3: `bases/a4-plain.typ`**

```typst
// Generische Basis ohne Briefkopf: Bericht, Bescheinigung, Auszug.
// Alle Farben/Schriften aus payload.brand.* (aktives Theme). Kein Vereinsspezifikum.
#let _org(p, k) = p.organization.at("organization." + k, default: "")

#let base(payload, slots, body) = {
  let b = payload.brand
  set document(title: slots.at("title", default: ""), author: _org(payload, "name"), date: none)
  set text(font: b.fontBody, size: 10.5pt, fill: rgb(b.ink), lang: "de")
  set par(justify: false, leading: 0.62em, spacing: 1.05em)
  set list(indent: 0.4em, body-indent: 0.5em)
  set enum(indent: 0.4em, body-indent: 0.5em)

  show heading: set text(font: b.fontHeading, fill: rgb(b.primary), weight: "semibold")
  show heading: set block(above: 1.2em, below: 0.6em)
  show heading.where(level: 1): set text(size: 17pt)
  show heading.where(level: 2): set text(size: 13pt)
  show raw: set text(font: b.fontMono, size: 9pt)
  show link: set text(fill: rgb(b.primary))
  show quote.where(block: true): it => block(width: 100%, inset: (x: 12pt, y: 9pt), fill: rgb(b.primarySoft), stroke: (left: 2pt + rgb(b.primary)), radius: 2pt)[#set text(size: 9.5pt); #it.body]
  show table.cell.where(y: 0): set text(fill: white, weight: "bold")
  set table(inset: (x: 8pt, y: 6pt), stroke: (_, y) => (bottom: 0.5pt + rgb(b.line)), fill: (_, y) => if y == 0 { rgb(b.primary) } else { none })

  set page(paper: "a4", margin: (top: 26mm, bottom: 24mm, left: 22mm, right: 20mm),
    header: context [
      #set text(size: 8pt, fill: rgb(b.muted))
      #grid(columns: (1fr, auto), [#_org(payload, "name")], [#payload.number])
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
    ],
    footer: context [
      #set text(size: 8pt, fill: rgb(b.muted))
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
      #v(2pt)
      #grid(columns: (1fr, auto),
        [#_org(payload, "name") · #_org(payload, "street") · #_org(payload, "postalCode") #_org(payload, "city")],
        [Seite #counter(page).display() von #counter(page).final().first()])
    ])

  if slots.at("title", default: "") != "" {
    text(font: b.fontHeading, size: 20pt, weight: "bold", fill: rgb(b.primary))[#slots.title]
    if slots.at("subtitle", default: "") != "" { linebreak(); text(size: 12pt, style: "italic", fill: rgb(b.muted))[#slots.subtitle] }
    v(3pt); line(length: 100%, stroke: 0.8pt + rgb(b.accent)); v(6mm)
  }
  body
}
```

- [ ] **Step 4: `bases/a4-mit-briefkopf.typ`**

Geschäftsbrief. Seite 1: Logo/Vereinsname oben rechts, Absender-Kleinzeile, Anschriftenfeld (ab 45 mm von oben, links, für Fensterkuvert), „Ort, Datum", Betreff. Ab Seite 2: Fortsetzungskopf (Vereinsname + „Seite N"). Fußzeile durchgehend. Struktur wie `a4-plain`, plus:

```typst
  set page(paper: "a4", margin: (top: 45mm, bottom: 24mm, left: 25mm, right: 20mm),
    header: context {
      if counter(page).get().first() > 1 {
        set text(size: 8pt, fill: rgb(b.muted))
        grid(columns: (1fr, auto), [#_org(payload, "name")], [Seite #counter(page).display()])
        line(length: 100%, stroke: 0.5pt + rgb(b.line))
      }
    },
    footer: /* wie a4-plain */)

  // Seite-1-Kopf
  context if counter(page).get().first() == 1 {
    place(top + right, dy: -20mm)[
      #if payload.logoFile != none { image(payload.logoFile, height: 16mm) } else { text(font: b.fontHeading, size: 15pt, fill: rgb(b.primary))[#_org(payload, "name")] }
    ]
    place(top + left, dy: -8mm)[#text(size: 7pt, fill: rgb(b.muted))[#_org(payload, "name") · #_org(payload, "street") · #_org(payload, "postalCode") #_org(payload, "city")]]
    if slots.at("recipient", default: "") != "" { block(spacing: 0pt)[#slots.recipient] ; v(12mm) }
    grid(columns: (1fr, auto), [], [#text(size: 9.5pt)[#_org(payload, "city"), #payload.issuedDate]])
    v(6mm)
    if slots.at("subject", default: "") != "" { text(weight: "bold")[#slots.subject] ; v(4mm) }
  }
  body
```

`place(dy: -20mm)` verrechnet den oberen Rand — Feineinstellung beim ersten Render.

- [ ] **Step 5: `bases/a4-ohne-briefkopf.typ`**

Wie `a4-mit-briefkopf`, aber ohne den Seite-1-Kopf-Block (kein Logo, kein Anschriftenfeld) — nur „Ort, Datum" + Betreff. Oberer Rand 26 mm.

- [ ] **Step 6: `bases/bases.json`**

```json
[
  { "id": "a4-plain", "label": "A4 ohne Briefkopf (Bericht)", "kind": "report" },
  { "id": "a4-mit-briefkopf", "label": "A4 mit Briefkopf", "kind": "letter" },
  { "id": "a4-ohne-briefkopf", "label": "A4 Brief-Folgeblatt", "kind": "letter" }
]
```

- [ ] **Step 7: Test ausführen — muss bestehen** (nach Task 4)

Run: `pnpm --filter @kompass/documents test bases bases-render`
Expected: grün, nachdem Task 4 `renderer.renderDocument` liefert.

- [ ] **Step 8: Commit**

```bash
git add packages/documents/templates/bases packages/documents/tests/bases-render.test.ts
git commit -m "feat(documents): three neutral A4 base templates"
```

---

### Task 4: `renderer.renderDocument` und der `DocumentTemplate`-Vertrag

**Files:**
- Modify: `packages/core/src/modules/manifest.ts`
- Modify: `packages/documents/src/renderer.ts`
- Modify: `packages/documents/src/templates.ts` (`buildPayload`)
- Modify: `packages/documents/tests/renderer.test.ts`

**Interfaces:**
- Produces:
  - `DocumentSlots`, `DocumentBody = { markdown: string } | { typst: string }`, `DocumentBuildResult = { base?: string; slots: DocumentSlots; body: DocumentBody }`
  - `DocumentTemplate` mit `base: string` und `build(data, ctx): DocumentBuildResult` statt `render`
  - `TypstRenderer.renderDocument(opts: { baseId: string; bases: Map<string, ResolvedBase>; bodyTypst: string; payload: object }): Promise<Uint8Array>`
  - `buildPayload(data, ctx)` → zusätzlich `brand.primarySoft`

- [ ] **Step 1: Test anpassen/schreiben**

`renderer.test.ts` umschreiben — die Tests laufen jetzt über `renderDocument({ baseId, bases, bodyTypst, payload })` statt `render('letterhead.typ', payload)`:

```ts
import { createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';
const bases = resolveBases(resolveAssetDirs({}));
const base = { brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' }, organization: { 'organization.name': 'Musterverein e.V.' }, logoFile: null, number: 'BRF-2026-001', issuedDate: '05.09.2026', slots: { kind: 'plain', title: 'Brief' } };

it('renders deterministically', async () => {
  const r = createTypstRenderer();
  const a = await r.renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'Erster Absatz.\n\nZweiter.', payload: base });
  const b = await r.renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'Erster Absatz.\n\nZweiter.', payload: base });
  expect(sha(a)).toBe(sha(b));
});

it('treats body typst literally when the caller passes escaped content', async () => {
  const r = createTypstRenderer();
  const bytes = await r.renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'Preis \\#panic("x") \\[box\\]', payload: base });
  expect(bytes.byteLength).toBeGreaterThan(1000);
});

it('fails loudly on an unknown base', async () => {
  await expect(createTypstRenderer().renderDocument({ baseId: 'gibtsnicht', bases, bodyTypst: 'x', payload: base })).rejects.toThrow();
});

it('fails loudly when a font family is unknown', async () => { /* fontBody: 'Comic Sans MS' → rejects /unknown font family/ */ });
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/documents test renderer`
Expected: FAIL — `renderDocument` fehlt am Renderer

- [ ] **Step 3: Vertrag in `manifest.ts`**

`render` durch `build` + `base` ersetzen, neue Typen (Wortlaut aus Spec §4). `DocumentRenderContext` bleibt.

- [ ] **Step 4: `renderer.renderDocument`**

In `packages/documents/src/renderer.ts`, im Objekt aus `createTypstRenderer`:

```ts
async renderDocument({ baseId, bases, bodyTypst, payload }) {
  const base = bases.get(baseId);
  if (!base) throw new Error(`unknown document base: ${baseId}`);
  const job = await mkdtemp(path.join(tmpdir(), 'kompass-typst-'));
  try {
    await mkdir(path.join(job, 'bases'), { recursive: true });
    for (const b of bases.values()) await writeFile(path.join(job, 'bases', `${b.id}.typ`), b.typst);
    await writeFile(path.join(job, 'body.typ'), `#let content = [\n${bodyTypst}\n]`);
    await writeFile(path.join(job, 'data.json'), JSON.stringify(payload));
    await writeFile(path.join(job, 'entry.typ'),
      `#import "bases/${baseId}.typ": base\n#import "body.typ": content\n#let payload = json("/data.json")\n#show: base.with(payload, payload.slots)\n#content\n`);
    await compileTypst({ binary: bin(), rootDir: job, fontsDir, entry: path.join(job, 'entry.typ'), output: path.join(job, 'out.pdf') });
    return new Uint8Array(await readFile(path.join(job, 'out.pdf')));
  } finally {
    await rm(job, { recursive: true, force: true });
  }
}
```

`render(templateFile, payload, logo)` bleibt vorerst **nicht** — er hat keinen Aufrufer mehr nach Task 5. Entfernen; `LOGO_EXT` und der Logo-in-Job-Zweig wandern in den Kern (`buildContext` schreibt `logoFile` in den Payload — Task 6).

Interface `TypstRenderer` anpassen: `render` raus, `renderDocument` rein, `version()` bleibt.

- [ ] **Step 5: `buildPayload` um `primarySoft`**

In `templates.ts`, `buildPayload`:

```ts
brand: {
  primary: t['color-primary'].light,
  primarySoft: t['color-primary-soft'].light,
  accent: t['color-accent'].light,
  // … ink, muted, line, fonts …
},
```

`templates.test.ts` „buildPayload maps theme tokens" um `primarySoft: '#E3EEF0'` erweitern.

- [ ] **Step 6: Typecheck (Kern + documents brechen — erwartet)**

Run: `pnpm --filter @kompass/documents typecheck`
Expected: Fehler in `templates.ts` (nutzt noch `render`) — behebt Task 5.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/manifest.ts packages/documents/src/renderer.ts packages/documents/src/templates.ts packages/documents/tests/renderer.test.ts packages/documents/tests/templates.test.ts
git commit -m "feat(documents): render a body into a chosen base; build() replaces render()"
```

---

### Task 5: `letterhead` und `audit-log-export` als `build()`

**Files:**
- Modify: `packages/documents/src/templates.ts`
- Delete: `packages/documents/templates/base.typ`, `letterhead.typ`, `audit-log-export.typ`
- Modify: `packages/documents/tests/templates.test.ts`

**Interfaces:**
- Consumes: `renderMarkdownTypst` aus `@kompass/markdown` (nur für den Kern, nicht hier); hier liefern die Templates `body: { markdown }` bzw. `{ typst }`
- Produces: `coreDocumentTemplates(): DocumentTemplate[]` mit `build()`

- [ ] **Step 1: Tests anpassen**

`templates.test.ts` letzter Test:

```ts
it('exposes letterhead (BRF) and audit-log-export (PRO) as build() with a default base', () => {
  const [letter, audit] = coreDocumentTemplates();
  expect([letter.key, letter.prefix, letter.base]).toEqual(['letterhead', 'BRF', 'a4-mit-briefkopf']);
  expect([audit.key, audit.prefix, audit.permission, audit.base]).toEqual(['audit-log-export', 'PRO', 'audit.view', 'a4-plain']);

  const r = letter.build({ title: 'Einladung', body: '# Hallo\n\nText.' }, ctx);
  expect(r.slots).toMatchObject({ kind: 'letter', title: 'Einladung' });
  expect(r.body).toEqual({ markdown: '# Hallo\n\nText.' });

  const a = audit.build({ title: 'Protokoll', filters: { Kanal: 'Alle' }, entries: [] }, { ...ctx, number: 'PRO-2026-001' });
  expect(a.slots.kind).toBe('report');
  expect('typst' in a.body).toBe(true);
});
```

`coreDocumentTemplates` nimmt keinen `renderer` mehr entgegen.

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/documents test templates`
Expected: FAIL

- [ ] **Step 3: `templates.ts` umschreiben**

```ts
export function coreDocumentTemplates(): DocumentTemplate[] {
  const letterheadSchema = z.object({ title: z.string().trim().min(1).max(120), body: z.string().max(20_000).default(''), base: z.string().optional() });
  const letterhead: DocumentTemplate<z.infer<typeof letterheadSchema>> = {
    key: 'letterhead', prefix: 'BRF', schema: letterheadSchema, base: 'a4-mit-briefkopf',
    build: (data) => ({
      base: data.base,
      slots: { kind: 'letter', title: data.title, subject: data.title },
      body: { markdown: data.body },
    }),
  };

  const auditExportSchema = z.object({ title: z.string().trim().min(1).max(120), filters: z.record(z.string(), z.string()).default({}), entries: z.array(z.object({ occurredAt: z.string(), userName: z.string().nullable(), channel: z.string(), action: z.string(), entityType: z.string(), entityId: z.string().nullable(), summary: z.string() })).max(2000) });
  const auditExport: DocumentTemplate<z.infer<typeof auditExportSchema>> = {
    key: 'audit-log-export', prefix: 'PRO', schema: auditExportSchema, permission: 'audit.view', base: 'a4-plain',
    build: (data) => ({ slots: { kind: 'report', title: data.title }, body: { typst: auditTable(data) } }),
  };
  return [letterhead as DocumentTemplate, auditExport as DocumentTemplate];
}
```

`auditTable(data)` erzeugt die Typst-Tabelle (Logik aus der gelöschten `audit-log-export.typ` — `#table(columns: …, table.header(…), ..entries.map(…))`; Werte über `escapeTypst()` absichern). `firstFontFamily`, `formatGermanDate`, `buildPayload` bleiben.

- [ ] **Step 4: Alte `.typ` löschen**

```bash
git rm packages/documents/templates/base.typ packages/documents/templates/letterhead.typ packages/documents/templates/audit-log-export.typ
```

- [ ] **Step 5: Test + Typecheck**

Run: `pnpm --filter @kompass/documents test && pnpm --filter @kompass/documents typecheck`
Expected: grün

- [ ] **Step 6: Commit**

```bash
git add packages/documents/src/templates.ts packages/documents/tests/templates.test.ts
git commit -m "feat(documents): letterhead and audit export as build() on generic bases"
```

---

### Task 6: `renderDocument` im Kern

**Files:**
- Modify: `packages/core/src/documents/service.ts`
- Modify: `packages/core/src/settings/core.ts`
- Modify: `packages/core/src/app.ts`, `packages/core/src/index.ts`
- Modify: `packages/core/tests/documents.test.ts`
- Modify: `apps/kompass/src/lib/deps.ts`

**Interfaces:**
- Consumes: `renderMarkdownTypst`, `resolveBases`/`resolveAssetDirs`/`probeBase`, `TypstRenderer.renderDocument`
- Produces:
  - `renderDocument` neu — Basis-Auflösung, `build()`, MD→Typst, `inputSnapshot = { input, slots, base, baseChecksum }`, PDF in Media-Ordner „Dokumente"
  - `listDocumentBases(deps): { id; label; kind; ok: boolean; error?: string }[]`
  - Einstellung `documents.bases` (`Record<string,string>`, default `{}`)
  - `CreateDepsOptions.documentBasesDir?: string`

- [ ] **Step 1: Tests anpassen**

`packages/core/tests/documents.test.ts` — der Test-`letter` bekommt `base` + `build` statt `render`:

```ts
const letter: DocumentTemplate<{ title: string }> = {
  key: 'test-letter', prefix: 'TST', base: 'a4-plain',
  schema: z.object({ title: z.string().min(1) }),
  build: (data) => ({ slots: { kind: 'plain', title: data.title }, body: { markdown: `# ${data.title}` } }),
};
```

`createTestDeps` bekommt `coreTemplates: [letter]` **und** einen echten Renderer + Bases-Verzeichnis (die generischen). Prüfen:
- Nummer lückenlos wie bisher.
- `getDocument(...).bytes` beginnt mit `%PDF-` (statt Klartext).
- `inputSnapshot` trägt `{ input: { title }, slots, base: 'a4-plain', baseChecksum: /^[0-9a-f]{64}$/ }`.
- Neuer Test: `documents.bases` = `{ 'test-letter': 'a4-mit-briefkopf' }` → das Dokument nutzt die andere Basis (im Snapshot sichtbar).
- Neuer Test: Basis fehlt (`base: 'weg'`) → `conflict('documentBaseUnavailable')`.
- `listDocumentBases` liefert die drei generischen mit `ok: true`.

`createTestDeps` in `packages/core/src/testing/index.ts` um `documentBasesDir` erweitern (Default: die mitgelieferten via `resolveAssetDirs`).

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/core test documents`
Expected: FAIL

- [ ] **Step 3: `documents.bases`-Einstellung**

`packages/core/src/settings/core.ts`, in `const documents` (neu):

```ts
const documentsSettings: SettingDefinition[] = [
  { key: 'documents.bases', schema: z.record(z.string(), z.string()), default: {} },
];
```

In `CORE_SETTINGS` aufnehmen.

- [ ] **Step 4: `renderDocument` umschreiben**

```ts
import { renderMarkdownTypst } from '@kompass/markdown';

async function buildContext(deps, ctx, number) {
  // wie bisher: organization, theme, logo, issuedAt
}

function resolveBase(deps: Deps, template: DocumentTemplate, wanted: string | undefined): string {
  const configured = readSetting<Record<string, string>>(deps, 'documents.bases')[template.key];
  return configured ?? wanted ?? template.base;
}

export async function renderDocument(deps, ctx, input) {
  // Rechte + renderSchema + Template-Lookup + template.permission + schema-validate — wie bisher
  const built = template.build(data.value, await buildContext(deps, ctx, 'PENDING')); // ctx ohne Nummer für build; Nummer kommt gleich
  const baseId = resolveBase(deps, template, built.base);
  const base = deps.documentBases.get(baseId);
  if (!base) return conflict('documentBaseUnavailable', `Basis-Vorlage „${baseId}" ist nicht verfügbar`);

  const bodyTypst = 'markdown' in built.body ? await renderMarkdownTypst(built.body.markdown) : built.body.typst;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const year = deps.clock.now().getUTCFullYear();
    const number = nextDocumentNumber(deps.db, template.prefix, year);
    const rctx = await buildContext(deps, ctx, number);
    const payload = { ...buildPayload(data.value, rctx), slots: built.slots, logoFile: /* aus rctx.logo, in Job schreiben lassen der Renderer? nein */ null };
    // Logo: der Renderer schreibt die Logo-Bytes in den Job und setzt logoFile — dafür renderDocument-opts um `logo` erweitern.
    const bytes = await deps.documentRenderer.renderDocument({ baseId, bases: deps.documentBases, bodyTypst, payload, logo: rctx.logo });
    const asset = await storeMediaInternal(deps, ctx, { originalName: `${number}.pdf`, bytes, declaredMimeType: 'application/pdf', folder: 'Dokumente' });
    if (!asset.ok) return asset;
    // Transaktion: inputSnapshot = JSON.stringify({ input: data.value, slots: built.slots, base: baseId, baseChecksum: base.checksum })
    // recordAudit wie bisher
  }
}
```

**`deps` erweitern:** `deps.documentRenderer: TypstRenderer` und `deps.documentBases: Map<string, ResolvedBase>` — in `createDeps` gefüllt aus `opts.documentBasesDir` bzw. dem Default. Reine Lesestruktur, beim Start einmal aufgelöst.

**Ordner „Dokumente":** `storeMediaInternal` mit `folder: 'Dokumente'` — analog Seed → „Webseite". Den Ordner beim ersten Dokument anlegen (wie in `applySeed`, `2026-09-08-site-seed`): vor dem ersten `storeMediaInternal` prüfen, ob `mediaFolders` „Dokumente" hat, sonst mit Audit `media.folder.create` einfügen.

- [ ] **Step 5: `listDocumentBases`**

```ts
export async function listDocumentBases(deps: Deps): Promise<{ id: string; label: string; kind: string; ok: boolean; error?: string }[]> {
  const out = [];
  for (const base of deps.documentBases.values()) {
    const probe = await probeBase({ renderer: deps.documentRenderer, baseId: base.id, bases: deps.documentBases });
    out.push({ id: base.id, label: base.label, kind: base.kind, ok: probe.ok, error: probe.ok ? undefined : probe.error });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
```

Export über `packages/core/src/index.ts`.

- [ ] **Step 6: `apps/kompass/src/lib/deps.ts`**

```ts
holder.deps = createDeps({
  // …
  documentBasesDir: readEnv().documentTemplatesDir, // KOMPASS_DOCUMENT_TEMPLATES_DIR, null in dev
});
```

`readEnv` (`packages/core/src/app.ts`) um `documentTemplatesDir` erweitern (aus `KOMPASS_DOCUMENT_TEMPLATES_DIR`, optional). `createDeps` löst `documentBases`/`documentRenderer` selbst auf (`createTypstRenderer` + `resolveBases`).

- [ ] **Step 7: Test + Typecheck**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: grün

- [ ] **Step 8: Commit**

```bash
git add packages/core/src packages/core/tests/documents.test.ts apps/kompass/src/lib/deps.ts
git commit -m "feat(core): renderDocument via Markdown, a chosen base and a frozen checksum"
```

---

### Task 7: Oberfläche und MCP

**Files:**
- Modify: `apps/kompass/src/app/(shell)/admin/documents/page.tsx`, `create-document-dialog.tsx`, `actions.ts`
- Create: `apps/kompass/src/app/(shell)/admin/documents/bases-panel.tsx`
- Modify: `apps/kompass/src/app/(shell)/admin/settings/*` (Abschnitt „Dokumente")
- Modify: `apps/kompass/messages/de.json`
- Modify: `packages/mcp/src/core-tools.ts`
- Modify: `apps/kompass/e2e/documents.spec.ts`, `apps/kompass/tests/mcp-tools.test.ts`

- [ ] **Step 1: MCP-Werkzeug**

In `core-tools.ts` nach `documents_void`:

```ts
t({ name: 'documents_bases', description: 'List the available document base templates and whether each renders. Requires documents.view.', inputSchema: z.object({}), handler: async (deps, ctx) => (requirePermission(ctx, 'documents.view') ?? ok(await listDocumentBases(deps))) }),
```

`mcp-tools.test.ts` deckt `documents.view` bereits über `documents_list` ab — kein `WITHOUT_MCP`-Eintrag betroffen. Test, dass `documents_bases` existiert.

- [ ] **Step 2: `bases-panel.tsx`**

Server-Component-Daten kommen aus `page.tsx` (`listDocumentBases(deps)`). Ein ausklappbarer Abschnitt über der Liste: je Basis `label`, `id` (mono), `kind`, Status-Badge (grün „bereit" / rot „fehlerhaft" mit `error` im Tooltip).

- [ ] **Step 3: `page.tsx`**

`const bases = await listDocumentBases(deps);` und `<BasesPanel bases={bases} />` über der Liste. `templates`-Liste erweitern: die Basis je Vorlage (`documents.bases[key] ?? template.base`) mitgeben (für Anzeige — nicht editierbar hier).

- [ ] **Step 4: Erzeugen-Dialog**

`create-document-dialog.tsx`: das `body`-Feld ist jetzt **Markdown**. Label/Hinweis anpassen (`documents.create.body` → „Text (Markdown)"), `maxLength` auf 20000, ein kurzer Hinweis „Überschriften mit #, Listen mit -, Tabellen wie in Markdown". `letterhead`-Checkbox **entfällt** (die Basis entscheidet). `actions.ts` `createLetterheadAction`: `input: { title, body }` (kein `letterhead` mehr).

- [ ] **Step 5: Einstellungen „Dokumente"**

Ein neuer Tab/Abschnitt in `admin/settings`: je registrierter Dokumentart eine Auswahl `documents.bases[key]` aus den `ok`-Basen (leer = Vorgabe der Vorlage). Schreibt über `setSetting` `documents.bases` als ganzes Record. An das vorhandene Settings-Formular-Muster (`settings-form.tsx`) anlehnen; falls das zu tief im generischen Formular sitzt, ein eigenes kleines Formular auf einer Unterseite `admin/settings/documents`.

- [ ] **Step 6: Übersetzungen**

`de.json`: `documents.bases.*` (Panel-Titel, Status), `documents.create.body` neu, `documents.create.letterhead` entfernen, `settings`-Einträge für den Dokumente-Abschnitt.

- [ ] **Step 7: e2e**

`documents.spec.ts` anpassen: Brief erzeugen mit Markdown im Textfeld (`# Titel` + Absatz), Vorschau zeigt Seiten, PDF herunterladbar. Neuer Test: Abschnitt „Basis-Vorlagen" listet `a4-mit-briefkopf` als „bereit".

- [ ] **Step 8: App-Tests, Typecheck, e2e**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app test && pnpm --filter @kompass/mcp test && pnpm --filter @kompass/app e2e documents`
Expected: grün

- [ ] **Step 9: Commit**

```bash
git add apps/kompass packages/mcp/src/core-tools.ts
git commit -m "feat(app): document base templates panel, Markdown body, per-type base setting"
```

---

### Task 8: Betrieb — Volume, Entrypoint, Image

**Files:**
- Modify: `Dockerfile`
- Create: `scripts/seed-document-templates.sh`
- Modify: `scripts/docker-entrypoint.sh`
- Modify: `apps/kompass/tests/entrypoint.test.ts`
- Modify: `docs/betrieb.md`

- [ ] **Step 1: Dockerfile**

Im `runner`-`ENV`-Block: `KOMPASS_DOCUMENT_TEMPLATES_DIR=/data/document-templates`. Die mitgelieferten `bases/` liegen schon unter `KOMPASS_TEMPLATES_DIR` (die `COPY … /packages/documents/templates …`-Zeile deckt `bases/` mit ab).

- [ ] **Step 2: `seed-document-templates.sh`**

```sh
#!/bin/sh
# Erstinbetriebnahme der Dokument-Basisvorlagen.
# Legt /data/document-templates an (leer bis auf README + bases.reference/ als
# Kopiervorlage). Leer ist gültig: dann gelten alle mitgelieferten Basen.
# Ein vorhandenes Verzeichnis bleibt unberührt.
set -eu
dir="${KOMPASS_DOCUMENT_TEMPLATES_DIR:-$(dirname "${DATABASE_PATH:-/data/kompass.db}")/document-templates}"
ship="${1:-/app/packages/documents/templates/bases}"
if [ ! -d "$dir" ]; then
  mkdir -p "$dir/bases.reference"
  cp "$ship"/*.typ "$ship"/bases.json "$dir/bases.reference/" 2>/dev/null || true
  cat > "$dir/README.md" <<'EOF'
# Dokument-Basisvorlagen

Lege hier `<id>.typ`-Dateien ab, um eine Basis-Vorlage zu ergänzen oder eine
mitgelieferte zu ersetzen (gleiche ID gewinnt). Jede exportiert
`#let base(payload, slots, body)` und setzt `set document(date: none)`.
Vorlagen zum Abkupfern in `bases.reference/`. Leer lassen = alle mitgelieferten.

Dieses Verzeichnis ist eine Vertrauensgrenze: Der Code läuft beim Rendern im Container.
EOF
fi
```

- [ ] **Step 3: `docker-entrypoint.sh`**

Nach `seed-site-template.sh` die Zeile `seed-document-templates.sh` ergänzen. Im Dockerfile die `COPY --chown=node:node scripts/seed-document-templates.sh /usr/local/bin/` + `chmod +x` mitnehmen.

- [ ] **Step 4: `entrypoint.test.ts`**

Ein `describe('seed-document-templates.sh')` analog zum vorhandenen: legt in ein leeres „Volume" `README.md` + `bases.reference/a4-plain.typ`; ein vorhandenes Verzeichnis bleibt unangetastet.

- [ ] **Step 5: `docs/betrieb.md`**

Abschnitt „Dokument-Basisvorlagen unter `/data/document-templates`" mit derselben Vertrauensgrenzen-Formulierung wie bei `/data/site-template`; Hinweis, dass ein leeres Verzeichnis alle mitgelieferten Basen bedeutet.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile scripts/seed-document-templates.sh scripts/docker-entrypoint.sh apps/kompass/tests/entrypoint.test.ts docs/betrieb.md
git commit -m "feat(docker): seed /data/document-templates on first start"
```

---

### Task 9: Gesamtlauf

**Files:**
- Modify: `docs/backlog.md` (falls ein Punkt die alte Dokumenten-Engine betrifft — prüfen)

- [ ] **Step 1: Spec-Abgleich**

Die Spec Abschnitt für Abschnitt gegen die Tasks prüfen:
- §4 Vertrag → Task 4
- §5 Markdown→Typst → Task 1
- §6 Basen (Auflösung, IDs, Vertrag, Prüf-Render, generische) → Task 2, 3
- §7 `renderDocument` neu → Task 6
- §8 Umbau der zwei Vorlagen → Task 5
- §10 Betrieb → Task 8
- §11 Oberfläche → Task 7
- §12 Tests → in jedem Task

- [ ] **Step 2: `no-association-content.test.ts` grün**

Run: `pnpm --filter @kompass/app test no-association`
Expected: grün — nichts Aluna-spezifisches in `packages/documents/templates/bases/`.

- [ ] **Step 3: Gesamtlauf**

Run: `PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" pnpm verify`
Expected: alle drei Ringe grün. Bei Fehlschlag beheben, den betroffenen Task-Commit ergänzen (kein `--amend` nach Push), erneut `pnpm verify`.

- [ ] **Step 4: Commit + Push**

```bash
git add -A
git commit -m "docs(backlog): document pipeline reworked to two stages"   # nur falls docs/backlog.md berührt
git push
```

---

## Self-Review (beim Schreiben durchgeführt)

**Spec-Abdeckung.** Jeder Spec-Abschnitt hat einen Task (Task 9 Step 1). Die vier Blöcke der Spec laufen als Task 1 / 2–3 / 4–6 / 7–8.

**Platzhalter.** Die drei generischen Basen (Task 3) sind als Typst-Gerüst mit den entscheidenden Blöcken angegeben, nicht Zeile für Zeile — Typst-Layout braucht einen Render-Blick (`place`/`dy` gegen den Seitenrand). Der Test (Step 1) legt fest, was gelten muss: PDF, Zweiseiten-Kopfwechsel, Determinismus. Kein „TBD".

**Typkonsistenz.**
- `DocumentBody = { markdown } | { typst }` — erzeugt in Task 5 (`build`), konsumiert in Task 6 (`renderDocument` → `renderMarkdownTypst` oder direkt).
- `DocumentSlots` — Task 4 definiert, Task 5 füllt, Task 3 (Basen) liest `slots.title/subject/recipient/…`.
- `ResolvedBase { id, typst, checksum, label, kind }` — Task 2, verwendet in Task 3 (Test), 6 (`deps.documentBases`, `baseChecksum` im Snapshot), 7 (`listDocumentBases`).
- `renderer.renderDocument({ baseId, bases, bodyTypst, payload, logo })` — Task 4 definiert, Task 3 + 6 rufen; `render(...)` entfällt vollständig (kein Aufrufer nach Task 5).
- `documents.bases: Record<string,string>` — Task 6 Einstellung, gelesen in `resolveBase`, geschrieben in Task 7 (Einstellungen).
- Audit-Aktion beim Ordner „Dokumente": `media.folder.create` — deckungsgleich mit `DELETION_POLICY` / `createMediaFolder` aus `2026-09-09-loeschbarkeit-und-mediathek`.

**Reihenfolge.** Task 3 (Basen-Render-Test) und Task 2 (Prüf-Render) brauchen `renderer.renderDocument` aus Task 4 — deshalb sind die Render-Tests in Task 2/3 „muss bestehen" auf „nach Task 4" vermerkt, die Commits davor tragen nur die nicht-render-abhängigen Teile grün. Alternativ 4 vor 2/3 ziehen; die Reihenfolge hier folgt dem Aufbau (erst Wandler, dann Basen, dann Verdrahtung).

**Abgrenzung.** Kein `document_template_state` in der DB (Spec §14): die Prüfsumme im `inputSnapshot` je Dokument ersetzt das „Einlesen". `renderMarkdown` (→ HTML, für die Webseite) bleibt unberührt; `renderMarkdownTypst` ist ein zweiter Ausgang desselben Parsers.
