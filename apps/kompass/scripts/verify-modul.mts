import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { installedModuleKeys, scopeFromPaths, type Scope } from '../e2e/projects';

/**
 * `pnpm verify:modul [-n] [modul ...]` — der Prüflauf je Task.
 *
 * Ohne Modul liest er die Änderungen des Arbeitsbaums gegen HEAD (und ohne
 * solche den letzten Commit) und leitet daraus ab, was zu prüfen ist
 * (`scopeFromPaths`): die Unit-Tests und der Typecheck der betroffenen Pakete
 * samt allem, was von ihnen abhängt, dazu die E2E-Projekte der Module plus
 * `kern`. Berührt die Änderung Geteiltes, läuft die volle Dev-Suite. Mit
 * Modulen als Argument wird die Auswahl erzwungen. `-n` zeigt nur den Plan.
 *
 * Vor dem Push bleibt es bei `pnpm verify` mit allen drei Ringen.
 */
const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '../..');

function git(...args: string[]): string[] {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles(): { files: string[]; source: string } {
  const workTree = [...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')];
  if (workTree.length > 0) return { files: [...new Set(workTree)], source: 'Arbeitsbaum gegen HEAD' };
  return { files: git('diff', '--name-only', 'HEAD~1', 'HEAD'), source: 'letzter Commit' };
}

function plan(scope: Scope): { label: string; steps: string[][] } {
  if (scope.kind === 'none') return { label: 'nur Arbeitsdokumente geändert — nichts zu prüfen', steps: [] };
  if (scope.kind === 'full') {
    return {
      label: 'Geteiltes betroffen — volle Dev-Suite (für den Push bleibt pnpm verify)',
      steps: [
        ['pnpm', 'typecheck'],
        ['pnpm', 'test'],
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
      ['pnpm', '--filter', '@kompass/app', 'exec', 'playwright', 'test', ...projects],
    ],
  };
}

const args = process.argv.slice(2);
const dryRun = args.includes('-n');
const requested = args.filter((arg) => arg !== '-n');
const modules = installedModuleKeys(APP);

let scope: Scope;
let origin: string;
if (requested.length > 0) {
  const unknown = requested.filter((key) => !modules.includes(key));
  if (unknown.length > 0) {
    console.error(`Unbekannte Module: ${unknown.join(', ')}. Bekannt: ${modules.join(', ')}`);
    process.exit(2);
  }
  scope = { kind: 'modules', modules: [...new Set(requested)].sort() };
  origin = 'Argument';
} else {
  const changed = changedFiles();
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
