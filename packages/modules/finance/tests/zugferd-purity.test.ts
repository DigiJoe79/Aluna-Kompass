import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(import.meta.dirname, '../src/import/zugferd');
const XML = path.resolve(import.meta.dirname, '../src/import/xml.ts');

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]!);

/**
 * Der ZUGFeRD-Parser (F5b) ist rein: Bytes hinein, Rechnung oder genannter
 * Fehler heraus. Er importiert nichts aus `@kompass/*` und nichts von außerhalb
 * von `zugferd/` — mit einer Ausnahme: `../xml`, die gemeinsamen
 * Sicherheitseinstellungen für fremdes XML, die er mit CAMT teilt. Die bleibt
 * nur erlaubt, solange sie selbst nichts außer `fast-xml-parser` lädt.
 * Muster: `csv-purity.test.ts`, `suggest-purity.test.ts`.
 */
describe('zugferd parser purity', () => {
  it('imports nothing from @kompass/* and nothing from outside zugferd/ but the shared xml guard', () => {
    expect(existsSync(DIR)).toBe(true);
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && f !== 'read.ts');
    expect(files).toContain('parse.ts');
    const offenders = files.flatMap((f) =>
      importsOf(path.join(DIR, f))
        .filter((spec) => spec.startsWith('@kompass/') || ((spec.startsWith('../') || spec === '..') && spec !== '../xml'))
        .map((spec) => `${f}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('the shared xml guard loads nothing but fast-xml-parser', () => {
    expect(importsOf(XML)).toEqual(['fast-xml-parser']);
  });
});
