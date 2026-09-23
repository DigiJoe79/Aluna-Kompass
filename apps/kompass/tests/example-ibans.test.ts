import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * Deutsche Beispiel-IBANs in Code, Tests, Seed und Handbuch tragen eine
 * erfundene Bankleitzahl: 99999999, oder 00000000 für einen reinen Platzhalter.
 * Die bekannte Beispielnummer mit BLZ 12030000 gehört zu einer echten Bank und
 * landete über den Seed auf der Beispiel-Webseite (Befundliste 0.2.0, N2).
 */
const GERMAN_IBAN = 'DE[0-9]{2}( ?[0-9]{4}){4} ?[0-9]{2}';
const ALLOWED_BANK_CODES = new Set(['99999999', '00000000']);
const SCOPE = ['packages', 'apps/kompass/src', 'apps/kompass/e2e', 'apps/kompass/tests', 'templates', 'scripts', 'docs/handbuch'];
const IGNORED = ['node_modules/', '/.next/', '/.astro/', '/dist/', '/e2e/.tmp/', '/.e2e-container/', 'test-results', 'tests/example-ibans.test.ts'];

function grep(args: string[]): string[] {
  try {
    const out = execFileSync('grep', args, { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter((line) => line.trim() && !IGNORED.some((skip) => line.includes(skip)));
  } catch {
    return []; // grep endet mit Code 1, wenn es nichts findet
  }
}

describe('Beispiel-IBANs', () => {
  it('tragen nur die erfundene Bankleitzahl 99999999 (oder 00000000 als Platzhalter)', () => {
    const offenders = SCOPE.flatMap((dir) => grep(['-rnoE', GERMAN_IBAN, dir]))
      .map((line) => {
        const at = line.lastIndexOf(':');
        return { where: line.slice(0, at), iban: line.slice(at + 1).replace(/ /g, '') };
      })
      .filter(({ iban }) => !ALLOWED_BANK_CODES.has(iban.slice(4, 12)));
    expect(offenders).toEqual([]);
  });

  it('nennen keine echte BIC', () => {
    expect(SCOPE.flatMap((dir) => grep(['-rln', 'BYLADEM1001', dir]))).toEqual([]);
  });
});
