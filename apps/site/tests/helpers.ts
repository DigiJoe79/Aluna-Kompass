import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const dirs: string[] = [];

export function build(env: Record<string, string>): string {
  const out = mkdtempSync(path.join(tmpdir(), 'site-dist-'));
  dirs.push(out);
  const r = spawnSync('pnpm', ['exec', 'astro', 'build', '--outDir', out], {
    cwd: ROOT,
    env: {
      ...process.env,
      SITE_CONTENT_DIR: path.join(ROOT, 'fixtures/example'),
      SITE_PUBLIC_URL: 'https://example.org',
      ...env,
    },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr + r.stdout);
  // Wie die Pipeline: die aufbereiteten Bildvarianten liegen neben dem Inhalt
  // und werden nach dem Build in die Ausgabe kopiert.
  const images = path.join(env.SITE_CONTENT_DIR ?? path.join(ROOT, 'fixtures/example'), 'images');
  if (existsSync(images)) cpSync(images, path.join(out, 'images'), { recursive: true });
  return out;
}

export function cleanupDirs(): void {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
}

/** Kopie der Beispiel-Fixture, bei der ein Feld der Vereinsdaten fehlt. */
export function contentWithout(field: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'site-content-'));
  dirs.push(dir);
  cpSync(path.join(ROOT, 'fixtures/example'), dir, { recursive: true });
  const file = path.join(dir, 'content.json');
  const content = JSON.parse(readFileSync(file, 'utf8')) as { facts: { organization: Record<string, string> }[] };
  delete content.facts[0]!.organization[field];
  writeFileSync(file, JSON.stringify(content, null, 2));
  return dir;
}
