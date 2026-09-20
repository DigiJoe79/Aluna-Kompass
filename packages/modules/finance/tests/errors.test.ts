import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FINANCE_ERRORS, financeConflict } from '../src/errors';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

describe('finance errors', () => {
  it('every error says why and what to do about it', () => {
    for (const [code, { reason, remedy }] of Object.entries(FINANCE_ERRORS)) {
      expect(reason.length, code).toBeGreaterThan(10);
      expect(remedy.length, code).toBeGreaterThan(10);
    }
  });

  it('fills placeholders and joins reason and remedy', () => {
    expect(financeConflict('cashWouldGoNegative', { account: 'K1', date: '2026-03-04', amount: '-12,50 €' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashWouldGoNegative', message: expect.stringMatching(/2026-03-04.*-12,50 €.*\. .+/) } });
  });

  it('is the only way the module raises a conflict', () => {
    const offenders = files(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith(`${path.sep}errors.ts`)).filter((f) => /\bconflict\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
