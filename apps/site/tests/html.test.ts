import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build, cleanupDirs } from './helpers';

describe('rendered html', () => {
  const dist = build({});
  const read = (p: string) => readFileSync(path.join(dist, p), 'utf8');

  afterAll(() => {
    cleanupDirs();
  });

  it('dog list carries filter data and the emergency badge; detail has mailto with subject', () => {
    const list = read('zuhause-gesucht/index.html');
    expect(list).toContain('data-notfall="1"');
    expect(list).toContain('data-groesse="45"');
    expect(list).toContain('Notfall');
    const chiara = read('zuhause-gesucht/chiara/index.html');
    expect(chiara).toContain('href="mailto:info@example.org?subject=Interesse+an+Chiara');
    expect(chiara).toContain('hreflang="en" href="https://example.org/en/looking-for-a-home/chiara/"');
    const adopted = read('zuhause-gesucht/akiko/index.html');
    expect(adopted).not.toContain('mailto:info@example.org?subject=Interesse');
  });

  it('project page embeds betterplace lazily (no iframe before click) and marks fallback texts', () => {
    const p = read('projekte/grundversorgung/index.html');
    expect(p).toContain('data-bp-src="https://www.betterplace.org/de/projects/000001/donate?');
    expect(p).not.toContain('<iframe');
    const en = read('en/projects/grundversorgung/index.html');
    expect(en).toContain('data-fallback="de"');
    expect(en).toContain('betterplace.org/en/projects/000001');
  });

  it('home shows facts and the featured dog and story', () => {
    const home = read('index.html');
    expect(home).toContain('97,2');
    expect(home).toContain('150');
    expect(home).toContain('Bruno'); // Notfall zuerst
    expect(home).toContain('Akiko');
  });

  it('no external scripts or cookies anywhere', () => {
    const home = read('index.html');
    expect(home).not.toMatch(/<script[^>]+src="https?:\/\//);
    expect(home).not.toContain('document.cookie');
  });
});
