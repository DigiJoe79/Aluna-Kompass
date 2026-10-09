import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { installedModuleKeys, parseVerifyArgs, scopeFromPaths, type Scope } from '../e2e/projects';

/**
 * `pnpm verify:modul [-n] [--alles | --seit <ref> | modul ...]` — der Prüflauf je Task.
 *
 * Ohne Auswahl liest er die Änderungen des Arbeitsbaums gegen HEAD und — ist
 * der sauber, etwa nach dem letzten Commit eines Plans — alles seit dem
 * Abzweig von `main` (`git merge-base HEAD main`); `--seit <ref>` nimmt einen
 * anderen Ausgangspunkt, `--alles` die volle Dev-Suite. Daraus leitet er ab, was zu prüfen ist
 * (`scopeFromPaths`): die Unit-Tests und der Typecheck der betroffenen Pakete
 * samt allem, was von ihnen abhängt, dazu die E2E-Projekte der Module plus
 * `kern`. Berührt die Änderung Geteiltes, läuft die volle Dev-Suite. Mit
 * Modulen als Argument wird die Auswahl erzwungen. `-n` zeigt nur den Plan.
 *
 * Vor dem Push bleibt es bei `pnpm verify` mit allen drei Ringen.
 */
const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '../..');

/**
 * Vor jedem E2E-Lauf kalt: Die Worker-Server bauen nach `.next/e2e/w<n>` (`e2e/servers.ts`). Ein warmer Cache
 * (am 05.10. 14 GB) ließ Turbopack mitten im Lauf in eine interne Panik laufen; der Server des Workers brach ab,
 * und danach scheiterten Tests der Mediathek, des Protokolls und der Akte mit 30-s-Zeitüberschreitungen. Kalt
 * war derselbe Code grün und mit 11 statt 21 Minuten sogar schneller.
 */
const COLD = ['rm', '-rf', path.join('apps', 'kompass', '.next', 'e2e')];

function git(...args: string[]): string[] {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function workTreeFiles(): string[] {
  return [...new Set([...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')])];
}

function changedFiles(since: string | undefined): { files: string[]; source: string } {
  const workTree = workTreeFiles();
  if (since === undefined && workTree.length > 0) return { files: workTree, source: 'Arbeitsbaum gegen HEAD' };
  const base = since ?? git('merge-base', 'HEAD', 'main')[0]!;
  const committed = git('diff', '--name-only', `${base}...HEAD`);
  const label = since === undefined ? `Abzweig von main (${base.slice(0, 8)})` : `seit ${since}`;
  return { files: [...new Set([...committed, ...workTree])], source: label };
}

function plan(scope: Scope): { label: string; steps: string[][] } {
  if (scope.kind === 'none') return { label: 'nur Arbeitsdokumente geändert — nichts zu prüfen', steps: [] };
  if (scope.kind === 'full') {
    return {
      label: 'Geteiltes betroffen — volle Dev-Suite (für den Push bleibt pnpm verify)',
      steps: [
        ['pnpm', 'typecheck'],
        ['pnpm', 'test'],
        COLD,
        ['pnpm', '--filter', '@kompass/app', 'e2e'],
      ],
    };
  }
  // `...{dir}` sind das Paket und seine Abhängigen. Dazu zählt das
  // Wurzelpaket, weil es jedes Modul als devDependency führt — und dessen
  // `typecheck` und `test` sind `pnpm -r …`, also wieder alles. Deshalb raus.
  const filters =
    scope.modules.length > 0
      ? [...scope.modules.flatMap((key) => ['--filter', `...{packages/modules/${key}}`]), '--filter', '!aluna-kompass']
      : ['--filter', '@kompass/app'];
  const projects = ['kern', ...scope.modules].flatMap((name) => ['--project', name]);
  return {
    label: scope.modules.length > 0 ? `Module: ${scope.modules.join(', ')} (plus Kern und Abhängige)` : 'nur App und Kern',
    steps: [
      ['pnpm', ...filters, 'typecheck'],
      ['pnpm', ...filters, 'test'],
      COLD,
      ['pnpm', '--filter', '@kompass/app', 'exec', 'playwright', 'test', ...projects],
    ],
  };
}

let args: ReturnType<typeof parseVerifyArgs>;
try {
  args = parseVerifyArgs(process.argv.slice(2));
} catch (error) {
  console.error(`[verify:modul] ${(error as Error).message}`);
  process.exit(2);
}
const { dryRun, modules: requested } = args;
const modules = installedModuleKeys(APP);

let scope: Scope;
let origin: string;
if (args.all) {
  scope = { kind: 'full' };
  origin = '--alles';
} else if (requested.length > 0) {
  const unknown = requested.filter((key) => !modules.includes(key));
  if (unknown.length > 0) {
    console.error(`Unbekannte Module: ${unknown.join(', ')}. Bekannt: ${modules.join(', ')}`);
    process.exit(2);
  }
  scope = { kind: 'modules', modules: [...new Set(requested)].sort() };
  origin = 'Argument';
} else {
  const changed = changedFiles(args.since);
  scope = scopeFromPaths(changed.files, modules);
  origin = `${changed.source}, ${changed.files.length} Dateien`;
}

const { label, steps } = plan(scope);
console.log(`[verify:modul] Umfang aus ${origin}: ${label}`);
for (const step of steps) console.log(`  ${step.join(' ')}`);
if (dryRun || steps.length === 0) process.exit(0);

const started = Date.now();
for (const [command, ...rest] of steps) {
  const result = spawnSync(command!, rest, { cwd: REPO, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[verify:modul] rot bei: ${[command, ...rest].join(' ')}`);
    process.exit(result.status ?? 1);
  }
}
console.log(`[verify:modul] grün in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);
