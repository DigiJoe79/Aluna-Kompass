import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const PRELOAD = pathToFileURL(path.resolve(import.meta.dirname, '../../../scripts/fake-date.mjs')).href;
const YEAR_MS = 365 * 86_400_000;
const PROBE = [
  'const Sub = class extends Date { tag() { return "sub"; } };',
  'console.log(JSON.stringify({ now: Date.now(), made: new Date().getTime(), fixed: new Date("2026-01-01T00:00:00.000Z").toISOString(),',
  '  called: typeof Date(), sub: new Sub().tag(), isDate: new Date() instanceof Date }));',
].join('\n');

function probe(env: Record<string, string>): { now: number; made: number; fixed: string; called: string; sub: string; isDate: boolean } {
  const rest: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['NODE_OPTIONS', 'FAKE_OFFSET_MS', 'FAKE_NOW']) delete rest[key];
  return JSON.parse(execFileSync(process.execPath, ['--import', PRELOAD, '-e', PROBE], { env: { ...rest, ...env }, encoding: 'utf8' }));
}

describe('scripts/fake-date.mjs', () => {
  it('moves the clock by FAKE_OFFSET_MS and leaves explicit dates, Date(), subclasses and instanceof intact', () => {
    const before = Date.now();
    const out = probe({ FAKE_OFFSET_MS: String(YEAR_MS) });
    expect(out.now - before).toBeGreaterThanOrEqual(YEAR_MS);
    expect(out.now - before).toBeLessThan(YEAR_MS + 60_000);
    expect(Math.abs(out.made - out.now)).toBeLessThan(1_000);
    expect(out).toMatchObject({ fixed: '2026-01-01T00:00:00.000Z', called: 'string', sub: 'sub', isDate: true });
  });

  it('takes FAKE_NOW as a point in time for a single process', () => {
    const out = probe({ FAKE_NOW: '2027-03-01T10:00:00.000Z' });
    expect(Math.abs(out.now - Date.parse('2027-03-01T10:00:00.000Z'))).toBeLessThan(60_000);
  });

  it('changes nothing without either variable', () => {
    const before = Date.now();
    expect(Math.abs(probe({}).now - before)).toBeLessThan(60_000);
  });
});
