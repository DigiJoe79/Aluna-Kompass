import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.join(ROOT, 'scripts/e2e-kalender.sh');
const dry = (...days: string[]) => spawnSync('sh', [SCRIPT, '-n', ...days], { encoding: 'utf8' });

describe('scripts/e2e-kalender.sh', () => {
  it('plans a cold dev ring under the e2e lock, the clock moved to 10:00 UTC of the day', () => {
    const run = dry('2099-03-01');
    expect(run.status).toBe(0);
    const offset = Number(/export FAKE_OFFSET_MS=(\d+)/.exec(run.stdout)![1]);
    expect(Math.abs(Date.now() + offset - Date.parse('2099-03-01T10:00:00.000Z'))).toBeLessThan(60_000);
    expect(run.stdout).toContain(`export NODE_OPTIONS=--import=file://${ROOT}/scripts/fake-date.mjs`);
    expect(run.stdout).toContain(`${ROOT}/scripts/e2e-lock.sh pnpm --dir ${ROOT} e2e:cold`);
  });

  it('defaults to the next 2 January, 1 March and 15 September — twice the year before as story year, once the running one', () => {
    const days = [...dry().stdout.matchAll(/== E2E am (\d{4}-\d{2}-\d{2}) ==/g)].map((m) => m[1]!);
    expect(days.map((d) => d.slice(5))).toEqual(['01-02', '03-01', '09-15']);
    for (const d of days) {
      const ahead = Date.parse(`${d}T10:00:00.000Z`) - Date.now();
      expect(ahead).toBeGreaterThan(0);
      expect(ahead).toBeLessThan(366 * 86_400_000);
    }
  });

  it('refuses a day in the past and a day that does not exist', () => {
    expect(dry('2020-01-02')).toMatchObject({ status: 64, stderr: expect.stringContaining('nur Tage nach heute') });
    expect(dry('2099-02-30')).toMatchObject({ status: 64, stderr: expect.stringContaining('kein Tag') });
  });
});
