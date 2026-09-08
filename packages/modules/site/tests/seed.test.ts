import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSeed } from '../src/seed';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures');

/** Legt ein Template-Verzeichnis mit einem seed/ an; `content` überschreibt die Fixture. */
function templateWithSeed(content?: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-seed-tpl-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'seed', 'assets'), { recursive: true });
  const json = content ?? JSON.parse(readFileSync(path.join(FIXTURE, 'seed', 'content.json'), 'utf8'));
  writeFileSync(path.join(dir, 'seed', 'content.json'), JSON.stringify(json));
  return dir;
}

describe('readSeed', () => {
  it('reads variables and collections from seed/content.json', async () => {
    const r = await readSeed(templateWithSeed());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.variables).toEqual({ claim: { de: 'Wir helfen.' }, pct: 97.2 });
    expect(r.value.collections.notes).toHaveLength(2);
    expect(r.value.assets).toEqual([]);
  });

  it('reads an assets array when present', async () => {
    const r = await readSeed(templateWithSeed({
      variables: {},
      assets: [{ id: 'logo', filename: 'logo.png', mimeType: 'image/png' }],
    }));
    expect(r.ok && r.value.assets).toEqual([{ id: 'logo', filename: 'logo.png', mimeType: 'image/png' }]);
  });

  it('defaults missing sections to empty', async () => {
    const r = await readSeed(templateWithSeed({ variables: { a: 1 } }));
    expect(r.ok && r.value.collections).toEqual({});
    expect(r.ok && r.value.assets).toEqual([]);
  });

  it('returns conflict noSeed when seed/content.json is absent', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-seed-none-'));
    dirs.push(dir);
    const r = await readSeed(dir);
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'noSeed').toBe(true);
  });

  it('returns validation error on malformed json', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-seed-bad-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'seed'), { recursive: true });
    writeFileSync(path.join(dir, 'seed', 'content.json'), '{ not json');
    const r = await readSeed(dir);
    expect(r.ok === false && r.error.type === 'validation').toBe(true);
  });

  it('returns validation error when a collection is not an array', async () => {
    const r = await readSeed(templateWithSeed({ collections: { notes: { body: 'x' } } }));
    expect(r.ok === false && r.error.type === 'validation').toBe(true);
  });
});
