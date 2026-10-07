import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.join(ROOT, 'scripts/e2e-kalender.sh');
const dry = (...days: string[]) => spawnSync('sh', [SCRIPT, '-n', ...days], { encoding: 'utf8' });

/** Runs the script with a stand-in `node` on PATH that runs `body` (a shell snippet). */
function withNode(body: string, ...args: string[]) {
  const bin = mkdtempSync(path.join(tmpdir(), 'kalender-node-'));
  try {
    writeFileSync(path.join(bin, 'node'), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, 'node'), 0o755);
    return spawnSync('sh', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } });
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

describe('scripts/e2e-kalender.sh', () => {
  it('plans a cold dev ring under the e2e lock, the clock moved to 10:00 UTC of the day', () => {
    const run = dry('2099-03-01');
    expect(run.status).toBe(0);
    const offset = Number(/export FAKE_OFFSET_MS=(\d+)/.exec(run.stdout)![1]);
    expect(Math.abs(Date.now() + offset - Date.parse('2099-03-01T10:00:00.000Z'))).toBeLessThan(60_000);
    expect(run.stdout).toContain(`export NODE_OPTIONS=--import=${pathToFileURL(path.join(ROOT, 'scripts/fake-date.mjs')).href}`);
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

  it('fails when node fails while working out the default days — never zero days with exit 0', () => {
    const broken = withNode('echo kaputt >&2; exit 3', '-n');
    expect(broken.status).not.toBe(0);
    expect(broken.stdout).not.toContain('== E2E am');
    const silent = withNode('exit 0', '-n');
    expect(silent.status).not.toBe(0);
    expect(silent.stderr).toContain('keine Tage');
  });

  it('fails when node fails while working out the offset of a day', () => {
    const broken = withNode('exit 3', '-n', '2099-03-01');
    expect(broken.status).not.toBe(0);
    expect(broken.stdout).not.toContain('export FAKE_OFFSET_MS');
  });

  it('percent-encodes the preload URL, so NODE_OPTIONS survives a space in the repo path', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'kalender repo '));
    try {
      mkdirSync(path.join(repo, 'scripts'));
      copyFileSync(SCRIPT, path.join(repo, 'scripts/e2e-kalender.sh'));
      const run = spawnSync('sh', [path.join(repo, 'scripts/e2e-kalender.sh'), '-n', '2099-03-01'], { encoding: 'utf8' });
      expect(run.status).toBe(0);
      const line = /^export NODE_OPTIONS=(.*)$/m.exec(run.stdout)![1]!;
      expect(line).not.toContain(' ');
      expect(line).toBe(`--import=${pathToFileURL(path.join(repo, 'scripts/fake-date.mjs')).href}`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
