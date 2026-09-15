import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const FIXTURE = path.join(ROOT, 'fixtures/example');
const dirs: string[] = [];

/** Baut das Template gegen die Beispiel-Fixture, wie es die Publish-Pipeline tut. */
export function build(env: Record<string, string> = {}): string {
  const out = mkdtempSync(path.join(tmpdir(), 'verein-basis-dist-'));
  dirs.push(out);
  const contentDir = env.SITE_CONTENT_DIR ?? FIXTURE;
  const r = spawnSync('pnpm', ['exec', 'astro', 'build', '--outDir', out], {
    cwd: ROOT,
    env: {
      ...process.env,
      SITE_CONTENT_DIR: contentDir,
      SITE_PUBLIC_URL: 'https://example.org',
      ...env,
    },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`${r.stderr}\n${r.stdout}`);
  // Die aufbereiteten Bildvarianten liegen neben dem Inhalt und werden nach dem
  // Build in die Ausgabe kopiert — genau wie in der Pipeline.
  const images = path.join(contentDir, 'images');
  if (existsSync(images)) cpSync(images, path.join(out, 'images'), { recursive: true });
  return out;
}

export function cleanupDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/**
 * Eine Kopie der Fixture, in der einzelne Stammdatenfelder überschrieben sind
 * — für die Fälle, die ein frisch gegründeter Verein mitbringt: noch keine
 * Registernummer, kein Telefon.
 */
export function fixtureWithout(overrides: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'verein-basis-fixture-'));
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  const file = path.join(dir, 'content.json');
  const content = JSON.parse(readFileSync(file, 'utf8')) as { views: { organization: Record<string, string>[] } };
  content.views.organization[0] = { ...content.views.organization[0]!, ...overrides };
  writeFileSync(file, JSON.stringify(content, null, 2));
  return dir;
}

/**
 * Baut das Template so, wie ein einsprachiger Verein es vorfindet: `'en'` in
 * `kompass.template.ts` gestrichen, sonst nichts geändert.
 *
 * Kopiert wird nur der Quelltext; `node_modules` wird verlinkt, weil Astro und
 * die Kompass-Pakete sonst zweimal installiert werden müssten.
 */
export function buildMonolingual(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'verein-basis-einsprachig-'));
  dirs.push(dir);
  for (const name of ['src', 'fixtures', 'kompass.template.ts', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
    const from = path.join(ROOT, name);
    if (existsSync(from)) cpSync(from, path.join(dir, name), { recursive: true });
  }
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

  const file = path.join(dir, 'kompass.template.ts');
  writeFileSync(file, readFileSync(file, 'utf8').replace("locales: ['de', 'en'],", "locales: ['de'],"));

  const out = mkdtempSync(path.join(tmpdir(), 'verein-basis-einsprachig-dist-'));
  dirs.push(out);
  // Nicht `pnpm exec`: Das Verzeichnis liegt außerhalb des Workspace, und pnpm
  // versuchte dort zu installieren. Die verlinkte Binary tut es genauso.
  const r = spawnSync(path.join(ROOT, 'node_modules/.bin/astro'), ['build', '--outDir', out], {
    cwd: dir,
    env: { ...process.env, SITE_CONTENT_DIR: path.join(dir, 'fixtures/example'), SITE_PUBLIC_URL: 'https://example.org' },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`${r.stderr}\n${r.stdout}`);
  return out;
}
