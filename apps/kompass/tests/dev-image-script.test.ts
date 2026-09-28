import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '../../../scripts/dev-image.sh');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Legt `docker` und `curl` als Attrappen an, die ihre Argumente mitschreiben. */
function fakeBin(): { bin: string; log: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'dev-image-'));
  dirs.push(dir);
  const log = path.join(dir, 'calls.log');
  for (const tool of ['docker', 'curl']) {
    const file = path.join(dir, tool);
    // `docker inspect` meldet sofort „healthy“, damit `up` nicht wartet.
    writeFileSync(file, `#!/bin/sh\necho "${tool} $*" >> "${log}"\ncase "$1" in inspect) echo healthy ;; esac\nexit 0\n`);
    chmodSync(file, 0o755);
  }
  return { bin: dir, log };
}

const run = (args: string[], bin: string, env: Record<string, string> = {}) =>
  execFileSync('sh', [SCRIPT, ...args], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env }, encoding: 'utf8', stdio: 'pipe' });

const calls = (log: string, tool: string) => readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith(`${tool} `));

describe('scripts/dev-image.sh', () => {
  it('publishes the port on 127.0.0.1 only and hands the reset token into the container', () => {
    const { bin, log } = fakeBin();
    run(['up'], bin);
    const runLine = calls(log, 'docker').find((l) => l.startsWith('docker run'))!;
    expect(runLine).toContain('-p 127.0.0.1:3300:3000');
    expect(runLine).toContain('E2E_RESET_TOKEN=lokal-seed');
  });

  it('seed posts the seeded reset with the token to localhost', () => {
    const { bin, log } = fakeBin();
    run(['seed'], bin, { KOMPASS_DEV_RESET_TOKEN: 'geheim-1' });
    const curlLine = calls(log, 'curl')[0]!;
    expect(curlLine).toContain('-X POST');
    expect(curlLine).toContain('x-e2e-token: geheim-1');
    expect(curlLine).toContain('http://127.0.0.1:3300/__e2e/reset?mode=seeded');
  });

  it('names seed in the usage line', () => {
    const { bin } = fakeBin();
    let message = '';
    try {
      run(['unbekannt'], bin);
    } catch (error) {
      message = String((error as { stderr?: string }).stderr);
    }
    expect(message).toContain('up|down|reset|seed');
  });
});
