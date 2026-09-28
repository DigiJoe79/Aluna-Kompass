import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');
/** Wer wen importieren darf (Spec 4.1). Neutraler Boden: die Dateien direkt in src/. */
const MAY_IMPORT: Record<string, readonly string[]> = { ledger: [], import: ['ledger'], donations: ['ledger'], allocation: ['ledger'], reporting: ['ledger', 'import', 'donations', 'allocation'] };

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const p = path.join(dir, name); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });

describe('import direction between the areas of the finance module', () => {
  it('lets an area import only itself, the areas it may know, and the neutral ground', () => {
    const offenders: string[] = [];
    for (const area of Object.keys(MAY_IMPORT)) {
      const dir = path.join(SRC, area);
      try { statSync(dir); } catch { continue; }
      for (const file of files(dir)) {
        for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
          const target = path.relative(SRC, path.resolve(path.dirname(file), spec!)).split(path.sep)[0]!;
          const neutral = !(target in MAY_IMPORT);
          if (!neutral && target !== area && !MAY_IMPORT[area]!.includes(target)) offenders.push(`${path.relative(SRC, file)} → ${target}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the neutral ground imports no area — except manifest.ts, install.ts, seed.ts, mcp-tools.ts, index.ts and dashboard.ts, which wire them', () => {
    const wiring = new Set(['manifest.ts', 'install.ts', 'seed.ts', 'mcp-tools.ts', 'index.ts', 'dashboard.ts']);
    const offenders = readdirSync(SRC).filter((n) => n.endsWith('.ts') && !wiring.has(n)).filter((n) => /from '\.\/(ledger|import|donations|allocation|reporting)\//.test(readFileSync(path.join(SRC, n), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
