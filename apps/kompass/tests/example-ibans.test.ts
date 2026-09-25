import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * Deutsche und österreichische Beispiel-IBANs in Code, Tests, Seed und
 * Handbuch tragen eine erfundene Bankleitzahl: 99999999/99999, oder
 * 00000000/00000 für einen reinen Platzhalter.
 * Die bekannte deutsche Beispielnummer mit BLZ 12030000 gehört zu einer
 * echten Bank und landete über den Seed auf der Beispiel-Webseite
 * (Befundliste 0.2.0, N2) — ebenso die bekannte österreichische Beispielnummer
 * `AT611904300234573201` mit BLZ 19043 (Befundliste 0.2.0, N2, § 4).
 */
const GERMAN_IBAN = 'DE[0-9]{2}( ?[0-9]{4}){4} ?[0-9]{2}';
const AUSTRIAN_IBAN = 'AT[0-9]{2}( ?[0-9]{4}){4}';
const ALLOWED_GERMAN_BANK_CODES = new Set(['99999999', '00000000']);
const ALLOWED_AUSTRIAN_BANK_CODES = new Set(['99999', '00000']);
const SCOPE = ['packages', 'apps/kompass/src', 'apps/kompass/e2e', 'apps/kompass/tests', 'templates', 'scripts', 'docs/handbuch'];
const IGNORED = ['node_modules/', '/.next/', '/.astro/', '/dist/', '/e2e/.tmp/', '/.e2e-container/', 'test-results', 'tests/example-ibans.test.ts'];

function grep(args: string[], cwd: string = ROOT): string[] {
  try {
    const out = execFileSync('grep', args, { cwd, encoding: 'utf8' });
    return out.split('\n').filter((line) => line.trim() && !IGNORED.some((skip) => line.includes(skip)));
  } catch {
    return []; // grep endet mit Code 1, wenn es nichts findet
  }
}

/**
 * Findet IBANs eines Musters in einem Verzeichnis und meldet jede, deren
 * Bankleitzahl nicht auf der erlaubten Liste steht — genutzt sowohl für den
 * echten Baum (`SCOPE`) als auch, in `catches an austrian iban with spaces`,
 * gegen eine Temp-Datei, damit der Wächter selbst geprüft ist.
 */
function findOffendingIbans(dir: string, pattern: string, bankCodeLength: number, allowedBankCodes: Set<string>, cwd: string = ROOT): { where: string; iban: string }[] {
  return grep(['-rnoE', pattern, dir], cwd)
    .map((line) => {
      const at = line.lastIndexOf(':');
      return { where: line.slice(0, at), iban: line.slice(at + 1).replace(/ /g, '') };
    })
    .filter(({ iban }) => !allowedBankCodes.has(iban.slice(4, 4 + bankCodeLength)));
}

describe('Beispiel-IBANs', () => {
  it('tragen nur die erfundene Bankleitzahl 99999999 (oder 00000000 als Platzhalter)', () => {
    const offenders = SCOPE.flatMap((dir) => findOffendingIbans(dir, GERMAN_IBAN, 8, ALLOWED_GERMAN_BANK_CODES));
    expect(offenders).toEqual([]);
  });

  it('austrian example ibans carry the invented bank code 99999', () => {
    const offenders = SCOPE.flatMap((dir) => findOffendingIbans(dir, AUSTRIAN_IBAN, 5, ALLOWED_AUSTRIAN_BANK_CODES));
    expect(offenders).toEqual([]);
  });

  it('catches an austrian iban with spaces', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'example-ibans-'));
    try {
      writeFileSync(path.join(dir, 'fixture.ts'), "const realBank = 'AT61 1904 3002 3457 3201';\n");
      const offenders = findOffendingIbans(dir, AUSTRIAN_IBAN, 5, ALLOWED_AUSTRIAN_BANK_CODES, dir);
      expect(offenders).toHaveLength(1);
      expect(offenders[0]!.iban).toBe('AT611904300234573201');

      writeFileSync(path.join(dir, 'fixture.ts'), "const inventedBank = 'AT93 9999 9000 0123 4567';\n");
      expect(findOffendingIbans(dir, AUSTRIAN_IBAN, 5, ALLOWED_AUSTRIAN_BANK_CODES, dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('nennen keine echte BIC', () => {
    expect(SCOPE.flatMap((dir) => grep(['-rln', 'BYLADEM1001', dir]))).toEqual([]);
  });
});
