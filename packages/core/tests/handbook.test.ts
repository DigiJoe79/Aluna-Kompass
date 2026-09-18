import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { handbookDir, listHandbookDocs, parseHandbookIndex, parseHandbookPage, readEnv, readHandbookAsset, readHandbookIndex, readHandbookPage } from '../src';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/handbuch');
const env = readEnv({ SESSION_SECRET: 'x'.repeat(32), KOMPASS_HANDBOOK_DIR: FIXTURE });

describe('handbook', () => {
  it('takes the directory from the environment and falls back to the repo', () => {
    expect(handbookDir(env)).toBe(FIXTURE);
    expect(handbookDir({ handbookDir: null })).toMatch(/docs[\\/]handbuch$/);
  });

  it('splits title, lead paragraph and body', () => {
    const page = readHandbookPage(env, 'einstieg/oberflaeche')!;
    expect(page.title).toBe('Die Oberfläche');
    expect(page.lead).toBe('Links die Schiene mit den Bereichen, daneben die Seiten des Bereichs, oben die\nKopfleiste. Hier finden Sie sich zurecht.');
    expect(page.body.startsWith('Links die Schiene')).toBe(true);
    expect(page.body).toContain('## Die Schiene');
    expect(page.body).not.toContain('# Die Oberfläche');
  });

  it('leaves the lead empty when a heading, list or image follows the title', () => {
    expect(readHandbookPage(env, 'ohne-kurzabsatz')!.lead).toBe('');
    expect(parseHandbookPage('x', '# T\n\n- eins\n').lead).toBe('');
    expect(parseHandbookPage('x', '# T\n\n![b](a.png)\n').lead).toBe('');
  });

  it('refuses unknown, escaping and absolute docs', () => {
    expect(readHandbookPage(env, 'gibt-es-nicht')).toBeNull();
    expect(readHandbookPage(env, '../package')).toBeNull();
    expect(readHandbookPage(env, '/etc/passwd')).toBeNull();
    expect(readHandbookPage(env, 'inhalt')).toBeNull();
  });

  it('reads and parses the index into chapters', () => {
    const chapters = parseHandbookIndex(readHandbookIndex(env));
    expect(chapters).toEqual([
      { title: 'Einstieg', pages: [{ doc: 'einstieg/oberflaeche', title: 'Die Oberfläche' }] },
      { title: 'Akte', pages: [{ doc: 'akte/post-ablegen', title: 'Post ablegen' }] },
      { title: 'Ohne Kurzabsatz', pages: [{ doc: 'ohne-kurzabsatz', title: 'Ohne Kurzabsatz' }] },
    ]);
  });

  it('serves images below bilder/ with their mime type and nothing else', () => {
    const asset = readHandbookAsset(env, 'akte/eingang.png')!;
    expect(asset.mimeType).toBe('image/png');
    expect(asset.bytes.byteLength).toBeGreaterThan(0);
    expect(readHandbookAsset(env, '../akte/post-ablegen.md')).toBeNull();
    expect(readHandbookAsset(env, '../../inhalt.md')).toBeNull();
    expect(readHandbookAsset(env, 'akte/eingang.txt')).toBeNull();
  });

  it('lists every doc except the index', () => {
    expect(listHandbookDocs(env).sort()).toEqual(['akte/post-ablegen', 'einstieg/oberflaeche', 'ohne-kurzabsatz']);
  });
});
