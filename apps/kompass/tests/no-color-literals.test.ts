import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../src');
const ALLOWED = new Set(['components/shell/env-banner.tsx']);
const PATTERN = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\()/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('no color literals in app source', () => {
  it('finds none outside the environment banner', () => {
    const offenders = walk(ROOT)
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .filter((f) => !ALLOWED.has(path.relative(ROOT, f)))
      .filter((f) => PATTERN.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
