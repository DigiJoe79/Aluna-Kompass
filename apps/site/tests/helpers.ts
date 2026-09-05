import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
  return out;
}

export function cleanupDirs(): void {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
}
