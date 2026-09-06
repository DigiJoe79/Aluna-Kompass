import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build, cleanupDirs, contentWithout } from './helpers';

afterAll(() => {
  cleanupDirs();
});

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
      'zuhause-gesucht/index.html',
      'en/looking-for-a-home/index.html',
      'zuhause-gesucht/chiara/index.html',
      'en/looking-for-a-home/chiara/index.html',
      'glueckliche-vermittlungen/index.html',
      'en/happy-endings/index.html',
      'projekte/index.html',
      'en/projects/index.html',
      'projekte/grundversorgung/index.html',
      'en/projects/grundversorgung/index.html',
      'wissenswertes/index.html',
      'en/good-to-know/index.html',
      'wissenswertes/ablauf-der-adoption/index.html',
      'faq/index.html',
      'en/faq/index.html',
      'ueber-uns/unser-team/index.html',
      'en/team/index.html',
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

  it('resolves every local asset referenced by the built pages', () => {
    const out = build({});
    const missing = new Set<string>();
    const walk = (d: string) => {
      for (const name of readdirSync(d).sort()) {
        const file = path.join(d, name);
        if (statSync(file).isDirectory()) {
          walk(file);
          continue;
        }
        if (!file.endsWith('.html')) continue;
        const html = readFileSync(file, 'utf8');
        for (const m of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
          const url = m[1].split(/[?#]/)[0];
          // Seitenlinks enden auf / oder .html und werden von den Routentests abgedeckt.
          if (url.endsWith('/') || url.endsWith('.html')) continue;
          if (!existsSync(path.join(out, url))) missing.add(`${path.relative(out, file)} → ${url}`);
        }
      }
    };
    walk(out);
    expect([...missing].sort()).toEqual([]);
  });

  it('offers the language switch on mobile, where the header switcher is hidden', () => {
    const out = build({});
    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    const panel = html.slice(html.indexOf('mobile-nav-panel'), html.indexOf('</details>'));
    expect(panel).toContain('mobile-nav-lang');
    expect(panel).toContain('>EN<');
    expect(panel).toContain('>DE<');
    // Der Umschalter muss auf die englische Entsprechung zeigen, nicht auf sich selbst.
    expect(panel).toContain('href="/en/"');
  });

  it('names the founding year in the hero and leaves the segment out when unset', () => {
    const withYear = build({});
    const eyebrow = (dir: string) => {
      const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
      const start = html.indexOf('eyebrow-light');
      return html.slice(start, html.indexOf('</p>', start));
    };
    expect(eyebrow(withYear)).toContain('Gegründet 2026');
    expect(eyebrow(build({ SITE_CONTENT_DIR: contentWithout('foundedYear') }))).not.toContain('Gegründet');
    // Kein hängender Trenner, wenn das Jahr fehlt.
    expect(eyebrow(build({ SITE_CONTENT_DIR: contentWithout('foundedYear') }))).not.toMatch(/·\s*<\/p>|·\s*$/);
  });

  it('ships an htaccess so Apache serves the generated error page, per language', () => {
    const out = build({});
    const root = readFileSync(path.join(out, '.htaccess'), 'utf8');
    expect(root).toContain('ErrorDocument 404 /404.html');
    // Verzeichnisauflistung abschalten: sonst zeigt Apache den Inhalt von /images/.
    expect(root).toContain('Options -Indexes');
    // Der englische Baum braucht seine eigene Fehlerseite.
    expect(readFileSync(path.join(out, 'en/.htaccess'), 'utf8')).toContain('ErrorDocument 404 /en/404/index.html');
    // Astro macht aus /en/404 ein Verzeichnis; nur die Wurzel wird zu 404.html.
    expect(readFileSync(path.join(out, 'en/404/index.html'), 'utf8')).toContain('<html lang="en"');
    expect(readFileSync(path.join(out, '404.html'), 'utf8')).toContain('<html lang="de"');
  });

  it('staging builds carry noindex and a disallow robots.txt', () => {
    const s = build({ SITE_STAGING: '1', SITE_PUBLIC_URL: 'https://staging.example.org' });
    expect(readFileSync(path.join(s, 'index.html'), 'utf8')).toContain('name="robots" content="noindex, nofollow"');
    expect(readFileSync(path.join(s, 'robots.txt'), 'utf8')).toContain('Disallow: /');
  });
});
