# Volltext 1 — Port, Binaries und Erkennung je Seite (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus einer PDF-Datei wird seitenweise Text — aus der Textebene, wenn sie eine hat, sonst über Texterkennung. Ohne dass irgendein Fachcode ein Binary kennt.

**Architecture:** `TextExtraction` ist ein Port im `Deps`-Vertrag, wie `documents` und `files`: Der Kern hält die Schnittstelle, ein eigenes Paket ruft `pdftotext`, `pdftoppm` und `tesseract` über `execFile`. Entschieden wird **je Seite**: Wer aus der Textebene genug Zeichen liefert, wird nicht erkannt. Der Kern selbst ruft den Port nie — er reicht ihn durch.

**Tech Stack:** TypeScript, Node `child_process`, Poppler 22.12, Tesseract 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-volltext-und-texterkennung-design.md` (§ 6 Die Erkennung als Port, § 11 Betrieb)

## Global Constraints

- Code Englisch, Oberflächentexte über i18n (`AGENTS.md`, Prinzip 7). Dieser Plan baut keine Oberfläche.
- Zeit über `deps.clock.now()` bzw. `isoNow(deps.clock)` — nie `new Date()` in Fachcode.
- Fachfehler sind `Result`-Werte, nie Exceptions. Nur technische Fehler werfen.
- **Kein Test vergleicht erkannten Text auf Gleichheit** (Spec § 11): Tesseract 5.3.0 im Container und 5.5.3 auf dem Mac liefern nicht denselben Wortlaut. Geprüft wird `toContain`, nie `toBe`.
- Schwellenwert: **100 Zeichen** je Seite aus der Textebene. Darunter gilt die Seite als Bild.
- Grenzen: **30 Sekunden je Seite**, **10 Minuten je Dokument**.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.

**Voraussetzung:** `brew install tesseract tesseract-lang poppler` auf dem Entwicklungsrechner. Prüfen mit `tesseract --version` (erwartet ≥ 5.3) und `pdftotext -v`.

---

### Task 1: Der Port im Kern

Zuerst der Vertrag, sonst hat das Paket aus Task 2 nichts zu erfüllen. Der Kern bekommt Schnittstelle, Attrappe und das Feld in `Deps` — mehr nicht; die Umsetzung kennt er nie.

**Files:**
- Create: `packages/core/src/text/extraction.ts`
- Modify: `packages/core/src/deps.ts`, `packages/core/src/index.ts`, `packages/core/src/testing/index.ts`
- Test: `packages/core/tests/text-extraction.test.ts`

**Interfaces:**
- Produces:
  - `interface PageText { page: number; text: string; source: 'layer' | 'ocr' }`
  - `interface TextExtraction { probe(): Promise<ProbeResult>; extract(opts: ExtractOptions): Promise<PageText[]> }`
  - `type ProbeResult = { ok: true; languages: string[] } | { ok: false; error: string }`
  - `interface ExtractOptions { bytes: Uint8Array; languages: string[] }`
  - `noopTextExtraction: TextExtraction` — `probe()` meldet `{ ok: false, error: 'no text extraction configured' }`, `extract()` wirft.
  - `fakeTextExtraction(opts?: { pages?: PageText[]; probe?: ProbeResult; onExtract?: (o: ExtractOptions) => void }): TextExtraction`
  - `deps.textExtraction: TextExtraction`
  - `createTestDeps({ textExtraction })` — Vorgabe ist `fakeTextExtraction()` mit einer Seite.

- [ ] **Step 1: Failing Test schreiben**

`packages/core/tests/text-extraction.test.ts`:

```ts
import { createTestDeps, fakeTextExtraction, noopTextExtraction } from '@kompass/core';
import { describe, expect, it } from 'vitest';

describe('text extraction port', () => {
  it('liefert in Tests eine Attrappe statt eines Binaries', async () => {
    const deps = createTestDeps();
    const probe = await deps.textExtraction.probe();
    expect(probe.ok).toBe(true);
    const pages = await deps.textExtraction.extract({ bytes: new Uint8Array([1]), languages: ['deu'] });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 1, source: 'layer' });
  });

  it('reicht durch, was der Test vorgibt, und merkt sich den Aufruf', async () => {
    const seen: { languages: string[] }[] = [];
    const deps = createTestDeps({
      textExtraction: fakeTextExtraction({
        pages: [
          { page: 1, text: 'Seite eins', source: 'layer' },
          { page: 2, text: 'Seite zwei', source: 'ocr' },
        ],
        onExtract: (o) => seen.push({ languages: o.languages }),
      }),
    });

    const pages = await deps.textExtraction.extract({ bytes: new Uint8Array([1]), languages: ['deu', 'eng'] });

    expect(pages.map((p) => p.source)).toEqual(['layer', 'ocr']);
    expect(seen).toEqual([{ languages: ['deu', 'eng'] }]);
  });

  it('meldet ohne Umsetzung, dass nichts eingerichtet ist', async () => {
    const probe = await noopTextExtraction.probe();
    expect(probe).toEqual({ ok: false, error: 'no text extraction configured' });
    await expect(noopTextExtraction.extract({ bytes: new Uint8Array(), languages: [] })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/core test -- text-extraction`
Expected: FAIL — `fakeTextExtraction` und `noopTextExtraction` sind nicht exportiert.

- [ ] **Step 3: Den Port schreiben**

`packages/core/src/text/extraction.ts`:

```ts
/** Eine Seite Text, plus die Herkunft — für Protokoll und Fehlersuche. */
export interface PageText {
  page: number;
  text: string;
  source: 'layer' | 'ocr';
}

export interface ExtractOptions {
  bytes: Uint8Array;
  /** Tesseract-Sprachkürzel, z. B. `['deu', 'eng']`. */
  languages: string[];
}

export type ProbeResult = { ok: true; languages: string[] } | { ok: false; error: string };

/**
 * Texterkennung, wie der Kern sie sieht. Die Umsetzung (Poppler, Tesseract)
 * liegt in `@kompass/text-extraction` — der Kern kennt nur diese Schnittstelle,
 * damit die Abhängigkeit einseitig bleibt und Tests ohne Binaries laufen.
 *
 * Der Kern **ruft sie selbst nie**; er reicht sie durch, wie `files('dms')`.
 */
export interface TextExtraction {
  /** Was die Umgebung kann: Binaries vorhanden, welche Sprachen installiert. */
  probe(): Promise<ProbeResult>;
  extract(opts: ExtractOptions): Promise<PageText[]>;
}

/** Fallback für Kontexte ohne Erkennung (Skripte, manche Tests). */
export const noopTextExtraction: TextExtraction = {
  probe: async () => ({ ok: false, error: 'no text extraction configured' }),
  extract: async () => {
    throw new Error('no text extraction configured');
  },
};

/** Attrappe für Service-Tests: feste Seiten, aufgezeichnete Aufrufe. */
export function fakeTextExtraction(
  opts: { pages?: PageText[]; probe?: ProbeResult; onExtract?: (o: ExtractOptions) => void } = {},
): TextExtraction {
  return {
    probe: async () => opts.probe ?? { ok: true, languages: ['deu', 'eng'] },
    extract: async (o) => {
      opts.onExtract?.(o);
      return opts.pages ?? [{ page: 1, text: 'Beispieltext', source: 'layer' }];
    },
  };
}
```

- [ ] **Step 4: In `Deps` aufnehmen**

In `packages/core/src/deps.ts` importieren und das Feld ergänzen — mit dem Satz, der die Frage „warum im Kern?" beantwortet:

```ts
  documents: DocumentEngine;
  /**
   * Texterkennung als Werkzeug des Containers, nicht als Fachlichkeit: Der Kern
   * besitzt, was außerhalb des Prozesses liegt, und reicht es durch. Er ruft es
   * selbst nie — heute benutzt es nur `dms`.
   */
  textExtraction: TextExtraction;
```

In `packages/core/src/index.ts` exportieren:

```ts
export * from './text/extraction';
```

In `packages/core/src/testing/index.ts` die Option und die Vorgabe ergänzen:

```ts
    documents?: DocumentEngine;
    textExtraction?: TextExtraction;
```

```ts
    documents: opts.documents ?? fakeDocumentEngine(),
    textExtraction: opts.textExtraction ?? fakeTextExtraction(),
```

- [ ] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/core test -- text-extraction`
Expected: PASS (3 Tests)

- [ ] **Step 6: Typecheck über das ganze Projekt**

Run: `pnpm typecheck`
Expected: Jede Stelle, die ein `Deps`-Objekt von Hand baut, verlangt jetzt `textExtraction`. Erwartete Fundstellen: `apps/kompass/src/lib/deps.ts` (dort `noopTextExtraction` einsetzen, Task 5 ersetzt es), `scripts/dev-reset.ts`, `packages/core/src/seed/cli.ts`. Alle mit `noopTextExtraction` füllen.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/text packages/core/src/deps.ts packages/core/src/index.ts packages/core/src/testing/index.ts packages/core/tests/text-extraction.test.ts apps/kompass/src/lib/deps.ts scripts/dev-reset.ts packages/core/src/seed/cli.ts
git commit -m "feat(core): a port for reading text out of a file"
```

---

### Task 2: Beispieldateien, die sich selbst bauen

Die Erkennung braucht zwei PDFs zum Prüfen: eines mit Textebene, eines ohne. Beide entstehen lokal aus Typst und Poppler — kein neues Werkzeug, kein Fremdmaterial, erfundener Inhalt (`no-association-content.test.ts` gilt auch für Testdaten).

**Files:**
- Create: `packages/text-extraction/tests/fixtures/brief.typ`, `packages/text-extraction/tests/fixtures/scan.typ`, `packages/text-extraction/tests/fixtures/build.sh`
- Create (erzeugt und committet): `packages/text-extraction/tests/fixtures/brief-digital.pdf`, `packages/text-extraction/tests/fixtures/brief-scan.pdf`

**Interfaces:**
- Produces: Zwei PDFs mit identischem sichtbaren Inhalt. `brief-digital.pdf` trägt eine Textebene, `brief-scan.pdf` ist ein Bild derselben Seite — der Fall „jemand hat abfotografiert".

- [ ] **Step 1: Die Quelle schreiben**

`packages/text-extraction/tests/fixtures/brief.typ`:

```typst
#set page(paper: "a4", margin: 2cm)
#set text(font: "Liberation Sans", size: 11pt, lang: "de")

Tierheim Musterstadt \
Beispielweg 4 \
12345 Musterstadt

#v(1cm)
*Tierarztrechnung 2026-4711*

#v(0.5cm)
Sehr geehrte Damen und Herren,

für die Behandlung der Kätzin Bärbel am 14. Oktober 2026 berechnen wir
Ihnen die Impfung und die Kastration wie folgt. Der Betrag ist innerhalb
von vierzehn Tagen zur Zahlung fällig.

#v(0.5cm)
Mit freundlichen Grüßen \
Praxis Dr. Sommer
```

`packages/text-extraction/tests/fixtures/scan.typ` — dieselbe Seite als Bild, randlos:

```typst
#set page(paper: "a4", margin: 0pt)
#image("brief-page.png", width: 100%, height: 100%, fit: "contain")
```

- [ ] **Step 2: Das Bauskript schreiben**

`packages/text-extraction/tests/fixtures/build.sh`:

```bash
#!/bin/sh
# Baut die beiden Beispiel-PDFs neu. Die Ergebnisse sind committet; dieses
# Skript läuft nur, wenn sich der Inhalt ändern soll.
#
# brief-digital.pdf — mit Textebene, der Schnellpfad muss ihn ohne OCR lesen.
# brief-scan.pdf    — dieselbe Seite als Bild, erzwingt den OCR-Rückfall.
set -eu
cd "$(dirname "$0")"

typst compile brief.typ brief-digital.pdf
pdftoppm -png -r 200 -singlefile brief-digital.pdf brief-page
typst compile scan.typ brief-scan.pdf
rm -f brief-page.png

# Gegenprobe: Der Scan darf keine Textebene haben.
if [ -n "$(pdftotext brief-scan.pdf - | tr -d '[:space:]')" ]; then
  echo "brief-scan.pdf traegt Text — dann prueft der OCR-Test nichts" >&2
  exit 1
fi
echo "ok"
```

- [ ] **Step 3: Skript ausführbar machen und laufen lassen**

```bash
chmod +x packages/text-extraction/tests/fixtures/build.sh
packages/text-extraction/tests/fixtures/build.sh
```

Expected: `ok`, und zwei PDFs liegen daneben. Schlägt `typst: command not found` fehl: Typst steht im Container, lokal über `brew install typst`.

- [ ] **Step 4: Mit dem Auge prüfen**

Run: `pdftotext packages/text-extraction/tests/fixtures/brief-digital.pdf - | head -20`
Expected: Der Brieftext erscheint, inklusive „Tierarztrechnung 2026-4711" und „Kätzin Bärbel".

- [ ] **Step 5: Commit**

```bash
git add packages/text-extraction/tests/fixtures
git commit -m "test(text): two invented letters, one with a text layer and one without"
```

---

### Task 3: Die Textebene lesen

Der Schnellpfad. `pdftotext` trennt Seiten mit dem Seitenvorschub `\f` (0x0C) — daraus entsteht die Seitenzahl, ohne zusätzliche Buchhaltung.

**Files:**
- Create: `packages/text-extraction/package.json`, `packages/text-extraction/tsconfig.json`, `packages/text-extraction/src/index.ts`, `packages/text-extraction/src/run.ts`, `packages/text-extraction/src/layer.ts`
- Test: `packages/text-extraction/tests/layer.test.ts`

**Interfaces:**
- Consumes: `PageText` (Task 1)
- Produces:
  - `runTool(bin: string, args: string[], opts: { input?: Uint8Array; timeoutMs: number }): Promise<Buffer>` — `execFile` mit Zeitlimit; wirft mit lesbarer Meldung, wenn das Binary fehlt (`ENOENT`) oder das Limit reißt.
  - `readTextLayer(bytes: Uint8Array, timeoutMs: number): Promise<string[]>` — je Seite ein Eintrag, in Seitenreihenfolge.

- [ ] **Step 1: Paket anlegen**

`packages/text-extraction/package.json`:

```json
{
  "name": "@kompass/text-extraction",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@kompass/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^26.4.1",
    "typescript": "^6.0.3",
    "vitest": "^5.0.0"
  }
}
```

`packages/text-extraction/tsconfig.json` — wörtlich von `packages/documents/tsconfig.json` übernehmen.

Danach `pnpm install` ausführen, damit der Workspace das Paket kennt.

- [ ] **Step 2: Failing Test schreiben**

`packages/text-extraction/tests/layer.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTextLayer } from '../src/layer';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name)));

describe('readTextLayer', () => {
  it('liest die Textebene eines digital erzeugten PDFs', async () => {
    const pages = await readTextLayer(fixture('brief-digital.pdf'), 30_000);

    expect(pages).toHaveLength(1);
    // Wortlaut nie auf Gleichheit pruefen — nur, dass der Inhalt da ist.
    expect(pages[0]).toContain('Tierarztrechnung');
    expect(pages[0]).toContain('Bärbel');
  });

  it('liefert für einen Scan eine leere Seite statt eines Fehlers', async () => {
    const pages = await readTextLayer(fixture('brief-scan.pdf'), 30_000);

    expect(pages).toHaveLength(1);
    expect(pages[0]!.trim()).toBe('');
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/text-extraction test`
Expected: FAIL — `../src/layer` gibt es nicht.

- [ ] **Step 4: Den Werkzeugaufruf schreiben**

`packages/text-extraction/src/run.ts`:

```ts
import { execFile } from 'node:child_process';

/**
 * Ein externes Werkzeug aufrufen, mit Zeitlimit und lesbarem Fehler. Die
 * Ausgabe kommt binär zurück, weil `pdftoppm` Bilder liefert.
 *
 * Fehlt das Binary, ist das keine Ausnahme im Fachsinn, sondern eine Aussage
 * über die Umgebung — der Aufrufer übersetzt sie in `unavailable`.
 */
export class ToolMissingError extends Error {}
export class ToolTimeoutError extends Error {}

export function runTool(
  bin: string,
  args: string[],
  opts: { input?: Uint8Array; timeoutMs: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout as Buffer);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return reject(new ToolMissingError(`${bin} ist nicht installiert`));
        if ((error as { killed?: boolean }).killed) {
          return reject(new ToolTimeoutError(`${bin} überschritt ${opts.timeoutMs} ms`));
        }
        return reject(new Error(`${bin} scheiterte: ${stderr.toString().slice(0, 400)}`));
      },
    );
    if (opts.input) {
      child.stdin?.end(Buffer.from(opts.input));
    }
  });
}
```

`packages/text-extraction/src/layer.ts`:

```ts
import { runTool } from './run';

/** `pdftotext` trennt Seiten mit dem Seitenvorschub 0x0C. */
const PAGE_BREAK = '\f';

/**
 * Liest die Textebene eines PDFs, je Seite ein Eintrag. Ein Scan liefert hier
 * leere Zeichenketten — das ist kein Fehler, sondern die Auskunft, dass diese
 * Seiten erkannt werden müssen.
 */
export async function readTextLayer(bytes: Uint8Array, timeoutMs: number): Promise<string[]> {
  const out = await runTool('pdftotext', ['-layout', '-', '-'], { input: bytes, timeoutMs });
  const pages = out.toString('utf8').split(PAGE_BREAK);
  // Der letzte Seitenvorschub steht am Dateiende und erzeugt einen leeren Rest.
  if (pages.length > 1 && pages[pages.length - 1]!.trim() === '') pages.pop();
  return pages;
}
```

`packages/text-extraction/src/index.ts`:

```ts
export * from './layer';
export * from './run';
```

- [ ] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/text-extraction test`
Expected: PASS (2 Tests)

- [ ] **Step 6: Commit**

```bash
git add packages/text-extraction pnpm-lock.yaml
git commit -m "feat(text): read the text layer a pdf already carries"
```

---

### Task 4: Der OCR-Rückfall, Seite für Seite

Jetzt die zweite Hälfte: Seiten unter dem Schwellenwert werden als Bild gerendert und erkannt. Wer genug Text hat, wird nicht angefasst — das spart auf der NAS-CPU die meiste Zeit.

**Files:**
- Create: `packages/text-extraction/src/ocr.ts`, `packages/text-extraction/src/extraction.ts`
- Modify: `packages/text-extraction/src/index.ts`
- Test: `packages/text-extraction/tests/extraction.test.ts`

**Interfaces:**
- Consumes: `readTextLayer`, `runTool` (Task 3), `TextExtraction`, `PageText` (Task 1)
- Produces:
  - `LAYER_MIN_CHARS = 100`, `PAGE_TIMEOUT_MS = 30_000`, `DOCUMENT_TIMEOUT_MS = 600_000`
  - `ocrPage(bytes: Uint8Array, page: number, languages: string[], timeoutMs: number): Promise<string>`
  - `createTextExtraction(): TextExtraction` — die echte Umsetzung.

- [ ] **Step 1: Failing Test schreiben**

`packages/text-extraction/tests/extraction.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTextExtraction } from '../src/extraction';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name)));

describe('createTextExtraction', () => {
  it('meldet die installierten Sprachen', async () => {
    const probe = await createTextExtraction().probe();

    expect(probe.ok).toBe(true);
    if (probe.ok) expect(probe.languages).toContain('deu');
  });

  it('nimmt die Textebene, wenn es eine gibt — ohne OCR', async () => {
    const pages = await createTextExtraction().extract({
      bytes: fixture('brief-digital.pdf'),
      languages: ['deu'],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.source).toBe('layer');
    expect(pages[0]!.text).toContain('Tierarztrechnung');
  });

  it('erkennt eine Seite, die nur ein Bild ist', async () => {
    const pages = await createTextExtraction().extract({
      bytes: fixture('brief-scan.pdf'),
      languages: ['deu'],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.source).toBe('ocr');
    // Wortlaut nie auf Gleichheit pruefen: Tesseract 5.3 und 5.5 unterscheiden
    // sich. Ein markantes, langes Wort reicht als Beweis, dass gelesen wurde.
    expect(pages[0]!.text.toLowerCase()).toContain('tierarztrechnung');
  }, 60_000);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/text-extraction test -- extraction`
Expected: FAIL — `../src/extraction` gibt es nicht.

- [ ] **Step 3: OCR je Seite schreiben**

`packages/text-extraction/src/ocr.ts`:

```ts
import { runTool } from './run';

/**
 * Eine einzelne Seite erkennen: erst als Bitmap rendern, dann durch Tesseract.
 * 300 dpi ist der Wert, bei dem Tesseract für Fließtext ausgelegt ist; darunter
 * leidet die Trefferquote, darüber wächst nur die Rechenzeit.
 */
export async function ocrPage(
  bytes: Uint8Array,
  page: number,
  languages: string[],
  timeoutMs: number,
): Promise<string> {
  const png = await runTool(
    'pdftoppm',
    ['-png', '-r', '300', '-f', String(page), '-l', String(page), '-singlefile', '-', '-'],
    { input: bytes, timeoutMs },
  );
  // `stdin`/`stdout` als `-`: Tesseract schreibt reinen Text nach stdout.
  const out = await runTool('tesseract', ['stdin', 'stdout', '-l', languages.join('+')], {
    input: png,
    timeoutMs,
  });
  return out.toString('utf8');
}
```

- [ ] **Step 4: Die Umsetzung des Ports schreiben**

`packages/text-extraction/src/extraction.ts`:

```ts
import type { PageText, ProbeResult, TextExtraction } from '@kompass/core';
import { readTextLayer } from './layer';
import { ocrPage } from './ocr';
import { runTool, ToolMissingError } from './run';

/**
 * Unter so vielen Zeichen gilt eine Seite als Bild. Der Wert beschreibt eine
 * Eigenschaft von PDFs, kein Vereinsspezifikum — deshalb Konstante und keine
 * Einstellung (Spec § 6). Ein Deckblatt mit Briefkopf und Betreff liegt
 * darüber, eine Scanseite mit Seitenzahl in der Fußzeile darunter.
 */
export const LAYER_MIN_CHARS = 100;
export const PAGE_TIMEOUT_MS = 30_000;
export const DOCUMENT_TIMEOUT_MS = 600_000;

function parseLanguages(out: string): string[] {
  // `tesseract --list-langs` schreibt eine Kopfzeile, dann je Zeile ein Kuerzel.
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes(' '));
}

export function createTextExtraction(): TextExtraction {
  return {
    async probe(): Promise<ProbeResult> {
      try {
        await runTool('pdftotext', ['-v'], { timeoutMs: 5_000 });
        const langs = await runTool('tesseract', ['--list-langs'], { timeoutMs: 10_000 });
        return { ok: true, languages: parseLanguages(langs.toString('utf8')) };
      } catch (error) {
        if (error instanceof ToolMissingError) return { ok: false, error: error.message };
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async extract({ bytes, languages }): Promise<PageText[]> {
      const started = Date.now();
      const layer = await readTextLayer(bytes, PAGE_TIMEOUT_MS);
      const pages: PageText[] = [];

      for (const [index, text] of layer.entries()) {
        const page = index + 1;
        if (text.trim().length >= LAYER_MIN_CHARS) {
          pages.push({ page, text, source: 'layer' });
          continue;
        }
        if (Date.now() - started > DOCUMENT_TIMEOUT_MS) {
          throw new Error(`Erkennung überschritt das Zeitlimit bei Seite ${page}`);
        }
        pages.push({ page, text: await ocrPage(bytes, page, languages, PAGE_TIMEOUT_MS), source: 'ocr' });
      }

      return pages;
    },
  };
}
```

`packages/text-extraction/src/index.ts` ergänzen:

```ts
export * from './extraction';
export * from './layer';
export * from './ocr';
export * from './run';
```

- [ ] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/text-extraction test`
Expected: PASS (5 Tests). Der OCR-Test braucht einige Sekunden — das ist der Punkt.

- [ ] **Step 6: Commit**

```bash
git add packages/text-extraction
git commit -m "feat(text): recognise the pages a pdf only shows as a picture"
```

---

### Task 5: Binaries im Container, in der CI und auf dem Rechner

Der Port ist fertig, aber noch verdrahtet ihn niemand. Jetzt bekommt die Anwendung die echte Umsetzung — und die drei Prüfringe bekommen ihre Werkzeuge.

**Files:**
- Modify: `Dockerfile`, `apps/kompass/next.config.ts`, `apps/kompass/src/lib/deps.ts`, `.github/workflows/ci.yml`, `docs/betrieb.md`, `AGENTS.md`
- Test: `apps/kompass/tests/text-extraction-wiring.test.ts`

**Interfaces:**
- Consumes: `createTextExtraction` (Task 4), `deps.textExtraction` (Task 1)
- Produces: Die laufende Anwendung hat einen Port, der echte Binaries ruft.

- [ ] **Step 1: Failing Test schreiben**

`apps/kompass/tests/text-extraction-wiring.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('Texterkennung ist verpackt', () => {
  it('das Image bringt Tesseract, die Sprachdaten und Poppler mit', () => {
    const dockerfile = read('Dockerfile');

    for (const pkg of ['tesseract-ocr', 'tesseract-ocr-deu', 'tesseract-ocr-eng', 'poppler-utils']) {
      expect(dockerfile).toContain(pkg);
    }
  });

  it('das neue Paket wird von Next übersetzt', () => {
    expect(read('apps/kompass/next.config.ts')).toContain('@kompass/text-extraction');
  });

  it('die Anwendung setzt die echte Umsetzung ein, nicht die Attrappe', () => {
    const deps = read('apps/kompass/src/lib/deps.ts');

    expect(deps).toContain('createTextExtraction');
    expect(deps).not.toContain('noopTextExtraction');
  });

  it('die CI installiert die Werkzeuge vor dem E2E-Lauf', () => {
    expect(read('.github/workflows/ci.yml')).toContain('tesseract-ocr-deu');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app test -- text-extraction-wiring`
Expected: FAIL, vier Fehlschläge.

- [ ] **Step 3: Das Image erweitern**

Im `runner`-Abschnitt des `Dockerfile` die vorhandene `apt-get install`-Zeile erweitern. Die Pakete bleiben **nach** dem `apt-get purge` erhalten, weil nur `curl` und `xz-utils` entfernt werden:

```dockerfile
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils rsync openssh-client sshpass \
      tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils \
```

Kommentar darüber:

```dockerfile
# Texterkennung fuer den Posteingang: Poppler liest die Textebene, Tesseract
# liest die Seiten, die nur ein Bild sind. Rund 117 MB, alles aus Debian —
# keine Fremdquelle, und nichts verlaesst das Geraet.
```

- [ ] **Step 4: Verdrahten**

In `apps/kompass/next.config.ts` `'@kompass/text-extraction'` zu `transpilePackages` hinzufügen. **Auch `'@kompass/module-dms'` ergänzen, falls es dort noch fehlt** — sonst bricht der Build, sobald das Modul das neue Paket zieht.

In `apps/kompass/src/lib/deps.ts` den Platzhalter aus Task 1 ersetzen:

```ts
import { createTextExtraction } from '@kompass/text-extraction';
```

```ts
  textExtraction: createTextExtraction(),
```

`apps/kompass/package.json` bekommt `"@kompass/text-extraction": "workspace:*"` unter `dependencies`; danach `pnpm install`.

Im `Dockerfile` die Zeile `COPY apps/kompass/package.json apps/kompass/` um eine Schwester ergänzen, damit `pnpm install` im `deps`-Abschnitt das neue Paket kennt:

```dockerfile
COPY packages/text-extraction/package.json packages/text-extraction/
```

- [ ] **Step 5: Die CI ausrüsten**

In `.github/workflows/ci.yml` vor dem Schritt, der die E2E-Suite startet:

```yaml
      - name: Texterkennung installieren
        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils
```

- [ ] **Step 6: Tests grün sehen**

Run: `pnpm --filter @kompass/app test -- text-extraction-wiring`
Expected: PASS (4 Tests)

- [ ] **Step 7: Die Einrichtung dokumentieren**

In `AGENTS.md` unter „Befehle" eine Zeile ergänzen:

```markdown
- Texterkennung lokal: `brew install tesseract tesseract-lang poppler` — ohne sie meldet die Akte „Texterkennung nicht verfügbar", und `packages/text-extraction` überspringt seine Tests nicht, sondern schlägt fehl.
```

In `docs/betrieb.md` im Abschnitt über das Image den Zuwachs nennen: rund 117 MB für Tesseract 5.3, die Sprachdaten für Deutsch und Englisch und Poppler; Sprachwahl über die Einstellung `dms.ocrLanguages`.

- [ ] **Step 8: Das Image wirklich bauen**

Run: `pnpm image`
Expected: Der Bau läuft durch. Danach gegenprüfen:

```bash
docker run --rm --entrypoint sh kompass-local -c "tesseract --version | head -1 && pdftotext -v 2>&1 | head -1 && tesseract --list-langs"
```

Expected: `tesseract 5.3.0`, `pdftotext version 22.12.0`, und `deu`, `eng`, `osd` in der Liste.

- [ ] **Step 9: Commit**

```bash
git add Dockerfile apps/kompass .github/workflows/ci.yml docs/betrieb.md AGENTS.md pnpm-lock.yaml
git commit -m "feat(ops): the container can read a scanned letter"
```

---

## Abschluss dieses Plans

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm verify` — der dritte Ring baut das Image; er ist hier die eigentliche Prüfung, weil er die Binaries im Container erwischt.

Danach: `2026-09-11-volltext-2-worker.md`.
