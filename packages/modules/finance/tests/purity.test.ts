import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

/**
 * Reine Dateien des Finanzmoduls: Sie rechnen nur mit dem, was man ihnen gibt, und laufen deshalb auch im Browser
 * (Client-Formulare) und in Tests ohne Datenbank. Einmal für alle geprüft (Testdurchsicht 2026-10-22, Plan P4 Task 3),
 * statt je Datei einen Wächter zu schreiben: jeder Unterpfad-Export aus `package.json` (die App lädt ihn im Client,
 * `apps/kompass/tests/client-imports.test.ts`) und diese Liste. Ein Ordner zählt mit allen Dateien darin.
 */
const PURE: Record<string, string> = {
  'allocation/reserve-rules.ts': 'Höchstbetrag der freien Rücklage — im Dienst und im Formular gerechnet.',
  'import/suggest': 'Vorschlagsfunktionen (F5): rechnen nur mit dem, was man ihnen gibt.',
  'import/zugferd': 'Der ZUGFeRD-Parser (F5b): Bytes hinein, Rechnung oder genannter Fehler heraus.',
  'rules-pure.ts': 'Die Regelprüfung auf neutralem Boden, für import/ und allocation/.',
  'ledger/amount-in-words.ts': 'Betrag in Worten für die Zuwendungsbestätigung.',
  'ledger/notice-validity.ts': 'Gültigkeit eines Freistellungsbescheids.',
  'ledger/machine-status.ts': 'Stand des maschinellen Verfahrens.',
};

/** Dateien in einem reinen Ordner, die bewusst nicht rein sind — mit Grund. */
const IMPURE_IN_PURE_DIR: Record<string, string> = {
  'import/zugferd/read.ts': 'Der Dienst um den Parser: liest das Dokument aus der Akte und legt Posten an.',
};

/** Pakete, die eine reine Datei laden darf: Sie ziehen weder Kern noch Datenbank. */
const ALLOWED_PACKAGES = new Set(['zod', 'fast-xml-parser']);

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');

/** Was eine Datei zur Laufzeit lädt; reine Typ-Importe fallen beim Übersetzen weg und zählen nicht. */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/^(import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'|import\s*\(\s*'([^']+)'\s*\)|^import\s+'([^']+)'/gm)]
    .filter((m) => !m[2])
    .map((m) => (m[3] ?? m[4] ?? m[5])!);
}

function resolveRelative(from: string, spec: string): string {
  const base = path.resolve(path.dirname(from), spec);
  const candidate = [`${base}.ts`, path.join(base, 'index.ts'), base].find((p) => existsSync(p) && statSync(p).isFile());
  if (!candidate) throw new Error(`${rel(from)}: ${spec} nicht gefunden`);
  return candidate;
}

/** Alles, was eine reine Datei über ihren Importgraphen erreicht und nicht laden darf. */
function offendersOf(entry: string): string[] {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of runtimeImports(file)) {
      if (spec.startsWith('.')) walk(resolveRelative(file, spec));
      else if (!ALLOWED_PACKAGES.has(spec)) offenders.push(`${rel(file)}: ${spec}`);
    }
  };
  walk(entry);
  return offenders;
}

const exported = Object.entries(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).exports as Record<string, string>)
  .filter(([subpath]) => subpath !== '.')
  .map(([, target]) => path.resolve(ROOT, target));
const listed = Object.keys(PURE).flatMap((entry) => {
  const full = path.join(SRC, entry);
  return statSync(full).isDirectory() ? files(full).filter((f) => f.endsWith('.ts') && !(rel(f) in IMPURE_IN_PURE_DIR)) : [full];
});

describe('pure files', () => {
  it('finds every subpath export and every listed file', () => {
    expect(exported.length).toBeGreaterThan(2);
    for (const file of [...exported, ...Object.keys(PURE).map((p) => path.join(SRC, p)), ...Object.keys(IMPURE_IN_PURE_DIR).map((p) => path.join(SRC, p))]) expect(existsSync(file), rel(file)).toBe(true);
  });

  it.each([...new Set([...exported, ...listed])].map((file) => [rel(file), file] as const))('%s loads neither @kompass/* nor a database, also not through its imports', (_name, file) => {
    expect(offendersOf(file)).toEqual([]);
  });
});
