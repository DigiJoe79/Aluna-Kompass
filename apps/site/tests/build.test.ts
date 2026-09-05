import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function build(env: Record<string, string>): string {
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

function hashTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        h.update(path.relative(dir, p));
        h.update(readFileSync(p));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

describe('site build', () => {
  it('builds every route in both languages with hreflang and is deterministic', () => {
    const a = build({});
    const b = build({});
    expect(hashTree(a)).toBe(hashTree(b));
    for (const p of [
      'index.html',
      'en/index.html',
      'helfen/index.html',
      'en/help/index.html',
      'impressum/index.html',
      'sitemap-index.xml',
    ]) {
      expect(existsSync(path.join(a, p)), p).toBe(true);
    }
    const help = readFileSync(path.join(a, 'helfen/index.html'), 'utf8');
    expect(help).toContain('<link rel="alternate" hreflang="en" href="https://example.org/en/help/"');
    expect(help).toContain('<html lang="de"');
    expect(help).not.toContain('noindex');
    expect(readFileSync(path.join(a, 'robots.txt'), 'utf8')).toContain('Sitemap: https://example.org/sitemap-index.xml');
    expect(readFileSync(path.join(a, 'en/help/index.html'), 'utf8')).toContain('<html lang="en"');
  });

  it('staging builds carry noindex and a disallow robots.txt', () => {
    const s = build({ SITE_STAGING: '1', SITE_PUBLIC_URL: 'https://staging.example.org' });
    expect(readFileSync(path.join(s, 'index.html'), 'utf8')).toContain('name="robots" content="noindex, nofollow"');
    expect(readFileSync(path.join(s, 'robots.txt'), 'utf8')).toContain('Disallow: /');
  });
});
