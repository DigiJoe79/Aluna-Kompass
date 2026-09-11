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

/** Der Text eines Elements vom Namen bis zum Ende des öffnenden Tags. */
function openingTags(text: string, name: string): string[] {
  const found: string[] = [];
  const start = new RegExp(`<${name}[\\s/>]`, 'g');
  for (const match of text.matchAll(start)) {
    const from = match.index;
    const end = text.indexOf('>', from);
    if (end > from) found.push(text.slice(from, end));
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
});
