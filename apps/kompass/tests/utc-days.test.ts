import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_TIME_ZONE } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { ASSOCIATION_TIME_ZONE, associationDay, associationYear } from '../e2e/association-day';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * W6 (Architektur-Review A4): „heute“ ist der Kalendertag in der Zeitzone des
 * Vereins (`todayIn`/`isoDayIn` aus `@kompass/core`), nicht der UTC-Tag. Zwischen
 * Mitternacht und ein bzw. zwei Uhr deutscher Zeit lag sonst der heutige Tag in
 * der Zukunft (`entryDateInFuture`, `movementDateInFuture`).
 *
 * Verboten im Fachcode von Kern und Modulen: ein Tag aus `toISOString()` und ein
 * eigener `today()`-Nachbau. In der App ist nur die serverseitige Form verboten
 * (`clock.now().toISOString()`), weil Client-Bausteine keine `deps` haben.
 */
const ALLOWED: Record<string, string> = {
  // Kalenderrechnung auf einem ISO-Datum: der Tag entsteht aus `T00:00:00.000Z`, kein Zeitpunkt ist beteiligt.
  'packages/modules/finance/src/ledger/fiscal-years.ts': 'dayAfter/yearEnd auf ISO-Daten',
  'packages/modules/finance/src/ledger/period.ts': 'dayAfter auf ISO-Datum',
  'packages/modules/finance/src/allocation/partner-proof.ts': 'addDaysInternal auf ISO-Datum',
  'packages/modules/finance/src/allocation/approvals.ts': 'addDays auf ISO-Datum',
};

function grep(pattern: string, ...dirs: string[]): string[] {
  try {
    // `--untracked`: auch Dateien, die noch nicht eingecheckt sind — sonst sieht der Wächter eine neue Datei erst nach dem Commit.
    return execFileSync('git', ['grep', '--untracked', '-n', '-E', pattern, '--', ...dirs], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('W6: kein UTC-Tag als „heute“', () => {
  it('kein Tag aus toISOString() und kein eigenes today() in Kern und Modulen', () => {
    const hits = [
      ...grep(String.raw`toISOString\(\)\.slice\(0, ?10\)|isoNow\([^)]*\)\.slice\(0, ?10\)`, 'packages/core/src', ':(glob)packages/modules/*/src/**'),
      ...grep(String.raw`const today = \(|function today\(`, 'packages/core/src', ':(glob)packages/modules/*/src/**'),
    ].filter((line) => !ALLOWED[line.split(':')[0]!]);
    expect(hits).toEqual([]);
  });

  it('kein UTC-Tag aus der Uhr in serverseitigem App-Code', () => {
    expect(grep(String.raw`clock\.now\(\)\.toISOString\(\)\.slice\(0, ?10\)`, 'apps/kompass/src')).toEqual([]);
  });

  it('kein Nummern- oder Auswahljahr aus UTC (Befund 46): das Jahr kommt aus yearIn(deps)', () => {
    expect(grep(String.raw`clock\.now\(\)\.getUTCFullYear\(\)`, 'packages/core/src', ':(glob)packages/modules/*/src/**', 'apps/kompass/src')).toEqual([]);
  });

  it('kein Tagesdatum aus der Browseruhr in Client-Bausteinen (Befund 47): der Server gibt es mit', () => {
    // Ausnahmen, je mit Grund: Kalenderrechnung auf einem ISO-Datum, das schon der Vereinstag ist.
    const allowedInApp: Record<string, string> = {
      'apps/kompass/src/app/(shell)/dms/[id]/follow-ups-panel.tsx': 'inOneWeek rechnet auf dem mitgegebenen `today`',
      'apps/kompass/src/lib/finance/notices.ts': 'dayBefore auf ISO-Datum',
    };
    const hits = grep(String.raw`toISOString\(\)\.slice\(0, ?10\)`, 'apps/kompass/src').filter((line) => !allowedInApp[line.split(':')[0]!]);
    expect(hits).toEqual([]);
    for (const file of Object.keys(allowedInApp)) expect(grep(String.raw`toISOString\(\)\.slice\(0, ?10\)`, file), file).not.toEqual([]);
  });

  it('kein UTC-Tag und kein UTC-Jahr als „heute“ in den E2E-Tests (W3): sie rechnen in der Vereinszeitzone', () => {
    // Nachtlauf 2026-09-28: zwischen 00:00 und 02:00 MESZ war der UTC-Tag der gestrige, der Server rechnete schon mit heute.
    expect(grep(String.raw`toISOString\(\)\.slice\(0, ?10\)|getUTCFullYear\(\)|const today = \(|function today\(`, 'apps/kompass/e2e')).toEqual([]);
  });

  it('der Vereinstag der E2E-Tests: dieselbe Zeitzone wie der Kern, um 00:30 MESZ schon der neue Tag', () => {
    expect(ASSOCIATION_TIME_ZONE).toBe(DEFAULT_TIME_ZONE);
    const halfPastMidnight = new Date('2026-09-27T22:30:00.000Z'); // 28.09.2026, 00:30 MESZ
    expect(associationDay(0, halfPastMidnight)).toBe('2026-09-28');
    expect(associationDay(1, halfPastMidnight)).toBe('2026-09-29');
    expect(associationDay(-1, halfPastMidnight)).toBe('2026-09-27');
    expect(associationYear(new Date('2026-12-31T23:30:00.000Z'))).toBe(2027);
    expect(associationDay(1, new Date('2026-10-24T22:30:00.000Z'))).toBe('2026-10-26'); // über die Zeitumstellung
  });

  it('die Ausnahmen gibt es noch', () => {
    for (const file of Object.keys(ALLOWED)) expect(grep(String.raw`toISOString\(\)\.slice\(0, ?10\)`, file), file).not.toEqual([]);
  });
});

describe('W6-Wächter sieht auch neue Dateien (Teil C Task 2d)', () => {
  it('findet einen Verstoß in einer noch nicht getrackten Datei', () => {
    const probe = path.join(ROOT, 'packages/core/src', `utc-probe-${process.pid}.ts`);
    writeFileSync(probe, 'export const probe = () => new Date().toISOString().slice(0, 10);\n');
    try {
      expect(grep(String.raw`toISOString\(\)\.slice\(0, ?10\)`, 'packages/core/src').some((line) => line.startsWith(path.relative(ROOT, probe)))).toBe(true);
    } finally {
      rmSync(probe, { force: true });
    }
  });
});
