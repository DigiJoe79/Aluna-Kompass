import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Eine Feldhöhe, ein Randstil, ein Fokusring. Vorher prallten drei Welten
 * aufeinander: `Input` mit 32 px, Auswahlfelder von Hand mit 34 px, die
 * Einstellungen mit 36 px. In derselben Formularzeile standen damit Felder
 * verschiedener Höhe. Die Höhe steht deshalb nur noch an einer Stelle —
 * `--field-h` — und die Bausteine lesen sie von dort.
 */
const ROOT = path.resolve(import.meta.dirname, '../src');
const SELECT = 'components/ui/select.tsx';
const CONTROLS = ['input.tsx', 'select.tsx', 'textarea.tsx', 'button.tsx'];
const CSS_PATH = path.resolve(ROOT, 'app/globals.css');
/** Alle Formularbausteine (Annahme 16, F8a Task 4) — Pfade relativ zu `src/`. */
const FONT_FILES = ['components/ui/input.tsx', 'components/ui/select.tsx', 'components/ui/textarea.tsx', 'components/ui/button.tsx', 'components/finance/amount-field.tsx'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function sources(): { rel: string; text: string }[] {
  return walk(ROOT)
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => ({ rel: path.relative(ROOT, f), text: readFileSync(f, 'utf8') }));
}

/**
 * Der Text eines Elements vom Namen bis zum Ende des öffnenden Tags. Das erste
 * `>` reicht nicht: In `onChange={(e) => …}` steht eines mitten im Tag, und die
 * Prüfung endete früher, als das Element zu Ende war — `h-[34px]` hinter einem
 * Ereignisbehandler blieb so jahrelang unbemerkt.
 */
function openingTags(text: string, name: string): string[] {
  const found: string[] = [];
  const start = new RegExp(`<${name}[\\s/>]`, 'g');
  for (const match of text.matchAll(start)) {
    let depth = 0;
    let quote = '';
    for (let i = match.index; i < text.length; i++) {
      const char = text[i]!;
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
      else if (char === '>' && depth === 0) {
        found.push(text.slice(match.index, i));
        break;
      }
    }
  }
  return found;
}

describe('field metrics', () => {
  it('leaves no hand-written select elements outside the building block', () => {
    const offenders = sources()
      .filter(({ rel }) => rel !== SELECT)
      .filter(({ text }) => /<select[\s>]/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('reads the one height from the token in every control', () => {
    const missing = CONTROLS.filter(
      (file) => !readFileSync(path.join(ROOT, 'components/ui', file), 'utf8').includes('var(--field-h)')
    );
    expect(missing).toEqual([]);
  });

  it('overrides the height of no field at the call site', () => {
    const offenders = sources().flatMap(({ rel, text }) =>
      ['Input', 'Select', 'Textarea']
        .flatMap((name) => openingTags(text, name))
        .filter((tag) => /\bh-\S/.test(tag))
        .map((tag) => `${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`)
    );
    expect(offenders).toEqual([]);
  });

  /**
   * F8a Task 4 (Annahme 16, Design-Referenz „Änderungen an früheren Phasen“):
   * Ein Finger trifft ein 38-px-Feld schlechter als ein Mauszeiger, und iOS
   * zoomt beim Fokus in ein Feld unter 16 px. `pointer: coarse` erkennt Touch
   * unabhängig von der Bildschirmbreite — zentral in `globals.css`, kein
   * zweiter Baustein.
   */
  it('sets 46px fields and 16px text under a coarse pointer', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const at = css.indexOf('@media (pointer: coarse)');
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('}', css.indexOf('}', at) + 1));
    expect(block).toMatch(/--field-h:\s*46px/);
    expect(block).toMatch(/--field-font:\s*16px/);
    expect(css).toMatch(/--field-font:\s*14px/);
  });

  it('reads the one text size from the token in every control and the amount field', () => {
    const missing = FONT_FILES.filter((file) => !readFileSync(path.join(ROOT, file), 'utf8').includes('var(--field-font)'));
    expect(missing).toEqual([]);
  });
});
