import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import template from '../kompass.template';
import { build, cleanupDirs } from './helpers';

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

describe('verein-basis', () => {
  it('declares only fields any club could fill', () => {
    const keys = Object.keys(template.variables).concat(Object.keys(template.collections));
    expect(keys).not.toContain('shelterDogCount');
    for (const key of keys) expect(key).not.toMatch(/dog|animal|shelter|tier|betterplace/i);

    for (const [, col] of Object.entries(template.collections)) {
      expect(col.label).not.toMatch(/tier|hund|shelter|betterplace/i);
      for (const field of Object.keys(col.fields)) {
        expect(field).not.toMatch(/dog|animal|shelter|tier|betterplace/i);
      }
    }
  });

  it('names one language and the four club collections', () => {
    expect(Object.keys(template.collections).sort()).toEqual(['documents', 'faq', 'news', 'team']);
    expect(template.locales).toEqual(['de']);
  });

  it('builds against the fixture and renders every declared collection', () => {
    const out = build();

    for (const p of [
      'index.html',
      'ueber-uns/index.html',
      'team/index.html',
      'aktuelles/index.html',
      'aktuelles/jahresrueckblick/index.html',
      'fragen-und-antworten/index.html',
      'spenden/index.html',
      'mitglied-werden/index.html',
      'kontakt/index.html',
      'impressum/index.html',
      'datenschutz/index.html',
      'satzung/index.html',
      'dokumente/satzung.pdf',
      '404.html',
      'robots.txt',
      'sitemap-index.xml',
    ]) {
      expect(existsSync(path.join(out, p)), p).toBe(true);
    }

    const home = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(home).toContain('Gemeinsam für unsere Sache.');
    expect(home).toContain('<html lang="de"');
    expect(home).not.toContain('noindex');

    const news = readFileSync(path.join(out, 'aktuelles/index.html'), 'utf8');
    expect(news).toContain('Unser Jahresrückblick');
    expect(news).toContain('Wir haben neue Räume');
    const article = readFileSync(path.join(out, 'aktuelles/jahresrueckblick/index.html'), 'utf8');
    expect(article).toContain('Was ansteht');

    const team = readFileSync(path.join(out, 'team/index.html'), 'utf8');
    expect(team).toContain('Alex Beispiel');
    expect(team).toContain('Vorsitz');

    const faq = readFileSync(path.join(out, 'fragen-und-antworten/index.html'), 'utf8');
    expect(faq).toContain('Wie kann ich mithelfen?');

    const statutes = readFileSync(path.join(out, 'satzung/index.html'), 'utf8');
    expect(statutes).toContain('/dokumente/satzung.pdf');

    expect(readFileSync(path.join(out, 'spenden/index.html'), 'utf8')).toContain('IBAN DE00');
    const join = readFileSync(path.join(out, 'mitglied-werden/index.html'), 'utf8');
    expect(join).toContain('Jahresbeitrag');
    expect(join).toContain('60');
  });

  it('is deterministic and resolves every asset the built pages reference', () => {
    const a = build();
    const b = build();
    expect(hashTree(a)).toBe(hashTree(b));

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
          if (url.endsWith('/') || url.endsWith('.html')) continue;
          if (!existsSync(path.join(a, url))) missing.add(`${path.relative(a, file)} -> ${url}`);
        }
      }
    };
    walk(a);
    expect([...missing].sort()).toEqual([]);
  });

  it('carries noindex and a disallow robots.txt in a staging build', () => {
    const s = build({ SITE_STAGING: '1', SITE_PUBLIC_URL: 'https://staging.example.org' });
    expect(readFileSync(path.join(s, 'index.html'), 'utf8')).toContain('name="robots" content="noindex, nofollow"');
    expect(readFileSync(path.join(s, 'robots.txt'), 'utf8')).toContain('Disallow: /');
  });
});
