import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
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
