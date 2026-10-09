import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Welche Spec zu welchem Modul gehört — und was eine Änderung prüfen muss.
 *
 * Die volle Suite läuft vor jedem Push (`pnpm verify`). Dazwischen, je Task,
 * reicht das Modul, an dem gearbeitet wird, plus der Kern: Anmeldung, Shell,
 * Startseite, Hydration, Modul-Aus — alles, wohin eine Modulmasse durchschlagen
 * kann. Die Zuordnung hängt am Dateinamen, weil der schon nach Modulen benannt
 * ist (`finance-*.spec.ts`); Ausnahmen stehen in `SPEC_ALIASES`, und
 * `tests/e2e-projects.test.ts` hält die Kern-Liste ausdrücklich, damit keine
 * neue Spec still dorthin rutscht.
 *
 * Die Umfangsableitung (`scopeFromPaths`) ist bewusst grob: Alles, was mehr
 * als ein Modul berührt — Kern, Bausteine der App, Gerüst, E2E-Infrastruktur,
 * Verpackung —, gibt die volle Suite. Lieber einmal zu viel prüfen als einen
 * Bruch bis zum Push tragen.
 */
export const KERN = 'kern';

/** Specs, deren Name nicht der Modulschlüssel ist. */
export const SPEC_ALIASES: Readonly<Record<string, string>> = {
  // Zusatzfelder der Akte.
  fields: 'dms',
};

/** Die Schlüssel der installierten Module — die Verzeichnisse unter `packages/modules`. */
export function installedModuleKeys(appRoot: string): string[] {
  return readdirSync(path.resolve(appRoot, '../../packages/modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function prefixOf(specFile: string): string {
  return path.basename(specFile).split(/[-.]/)[0]!;
}

/** Das Projekt einer Spec: ihr Modul oder `kern`. */
export function specProject(specFile: string, modules: readonly string[]): string {
  const prefix = prefixOf(specFile);
  const aliased = SPEC_ALIASES[prefix];
  if (aliased) return aliased;
  return modules.includes(prefix) ? prefix : KERN;
}

/** Die `testMatch`-Muster eines Projekts, aus den vorhandenen Specs gebildet. */
export function testMatchFor(project: string, specFiles: readonly string[], modules: readonly string[]): string[] {
  return specFiles.filter((file) => specProject(file, modules) === project).map((file) => `**/${path.basename(file)}`);
}

export type Scope = { kind: 'none' } | { kind: 'full' } | { kind: 'modules'; modules: string[] };

/** Nur Text für Menschen, nichts, was gebaut oder getestet wird. */
function isPaperwork(file: string): boolean {
  if (file.startsWith('docs/intern/')) return true;
  if (file.startsWith('.github/')) return true;
  if (file.startsWith('docs/handbuch/')) return false;
  return file.endsWith('.md');
}

/** Das Modul, dem eine Datei allein gehört — oder null. */
function moduleOf(file: string, modules: readonly string[]): string | null {
  const patterns = [
    /^packages\/modules\/([^/]+)\//,
    /^apps\/kompass\/src\/app\/\(shell\)\/([^/]+)\//,
    /^apps\/kompass\/src\/app\/([^/]+)\//,
    /^apps\/kompass\/src\/lib\/([^/]+)\//,
    /^apps\/kompass\/src\/components\/([^/]+)\//,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(file);
    if (match && modules.includes(match[1]!)) return match[1]!;
  }
  const spec = /^apps\/kompass\/e2e\/([^/]+\.spec\.ts)$/.exec(file);
  if (spec) {
    const project = specProject(spec[1]!, modules);
    return project === KERN ? null : project;
  }
  return null;
}

/**
 * Dateien, die nur die App-Unit-Tests und den Kern brauchen.
 *
 * Die Sprachdatei gehört dazu: Jede Maskenarbeit fasst sie an, und als
 * „Geteiltes“ zog sie am 26.09. in jedem Task die volle Suite nach. Ein
 * geänderter Text ist durch das Modul gedeckt, das ihn zeigt (dessen Dateien
 * stehen im selben Diff), durch die Wortlaut-Tests der App und den Kern.
 */
function isAppLocal(file: string): boolean {
  return file.startsWith('docs/handbuch/') || file.startsWith('apps/kompass/tests/') || file.startsWith('apps/kompass/messages/');
}

export function scopeFromPaths(files: readonly string[], modules: readonly string[]): Scope {
  const touched = new Set<string>();
  let anything = false;
  for (const file of files) {
    if (isPaperwork(file)) continue;
    anything = true;
    const owner = moduleOf(file, modules);
    if (owner) {
      touched.add(owner);
      continue;
    }
    if (isAppLocal(file)) continue;
    // Kern, geteilte Bausteine, Gerüst, E2E-Infrastruktur, Verpackung, Template.
    return { kind: 'full' };
  }
  if (!anything) return { kind: 'none' };
  return { kind: 'modules', modules: [...touched].sort() };
}

/** Die Argumente von `pnpm verify:modul` (`scripts/verify-modul.mts`). */
export type VerifyArgs = { dryRun: boolean; all: boolean; since: string | undefined; modules: string[] };

/**
 * `[-n] [--alles | --seit <ref> | modul …]`. Ohne Auswahl prüft der Lauf die Änderungen des Arbeitsbaums und,
 * ist der sauber, alles seit dem Abzweig von `main` — so prüft der letzte Schritt eines Plans, was der Branch
 * geändert hat, statt „nichts zu prüfen“ zu melden (Befund 14 in 0.2.9, Joe 2026-10-08).
 */
export function parseVerifyArgs(argv: readonly string[]): VerifyArgs {
  const parsed: VerifyArgs = { dryRun: false, all: false, since: undefined, modules: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '-n') parsed.dryRun = true;
    else if (arg === '--alles') parsed.all = true;
    else if (arg === '--seit') {
      const ref = argv[i + 1];
      if (!ref || ref.startsWith('-')) throw new Error('--seit braucht einen Git-Ref, z. B. --seit v0.2.8');
      parsed.since = ref;
      i += 1;
    } else parsed.modules.push(arg);
  }
  if ([parsed.all, parsed.since !== undefined, parsed.modules.length > 0].filter(Boolean).length > 1)
    throw new Error('--alles, --seit und Module schließen sich aus');
  return parsed;
}
