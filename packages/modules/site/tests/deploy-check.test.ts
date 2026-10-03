import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginRun,
  checkDeployTarget,
  classifyDeployError,
  endRun,
  parseListing,
  rsyncWith,
  runDeployCheck,
  siteModule,
  type DeployCheckIo,
  type SiteJobKind,
  type SiteJobStep,
} from '../src';
import { runChild } from '../src/pipeline/child';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(d, 0o755);
    } catch {
      // schon weg
    }
    rmSync(d, { recursive: true, force: true });
  }
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-dcheck-'));
  dirs.push(d);
  return d;
};
const deps = () => {
  const d = createTestDeps({ manifests: [coreModule, siteModule] });
  insertUser(d, { id: 'USER-TEST' });
  return d;
};
const publishCtx = ctxWith(['site.publish']);
const envFor = (target: string) => ({
  publicUrl: 'https://x',
  staging: true,
  deploy: { host: '', user: '', path: target, auth: { kind: 'none' as const } },
  templateDir: tmp(),
  cacheDir: tmp(),
  previewDir: tmp(),
  workDir: tmp(),
});
const lastRecord = (env: { cacheDir: string }, kind: SiteJobKind) =>
  JSON.parse(readFileSync(path.join(env.cacheDir, `${kind}-result.json`), 'utf8')) as { steps: SiteJobStep[] };

describe('parseListing', () => {
  it('reads regular files from GNU and openrsync, sizes with separators or missing', () => {
    const gnu = 'drwxr-xr-x          4,096 2026/10/03 09:33:07 .\n-rw-r--r--          1,234 2026/10/03 09:33:07 index.html\n-rw-r--r--              2 2026/10/03 09:33:07 sub/b c.png';
    const open = 'drwxr-xr-x          128 2026/10/03 09:33:07 .\n-rw-r--r--              2026/10/03 09:33:12 leer.txt';
    expect(parseListing(gnu)).toEqual(['index.html', 'sub/b c.png']);
    expect(parseListing(open)).toEqual(['leer.txt']);
  });
});

describe('classifyDeployError', () => {
  it.each([
    ['user@h: Permission denied (publickey,password).', 'connect', 'authFailed'],
    ['Permission denied, please try again.', 'connect', 'authFailed'],
    ['ssh: Could not resolve hostname x: nodename nor servname provided', 'connect', 'unreachable'],
    ['ssh: connect to host x port 22: Connection timed out', 'connect', 'unreachable'],
    ['bash: rsync: command not found', 'connect', 'rsyncMissing'],
    ['rsync: [sender] change_dir "/www/x" failed: No such file or directory (2)', 'targetDir', 'targetMissing'],
    ['rsync(1): error: nope/: (l)stat: No such file or directory', 'targetDir', 'targetMissing'],
    ['rsync: mkstemp "/www/.kompass-probe-1.XyZ" failed: Permission denied (13)', 'writable', 'notWritable'],
    ['rsync: write failed on "/www/x": No space left on device (28)', 'writable', 'diskFull'],
    ['rsync hat das Zeitlimit ueberschritten', 'connect', 'unreachable'],
    ['irgendwas', 'transfer', 'unknown'],
  ] as const)('%s → %s', (text, stage, problem) => expect(classifyDeployError(text, stage)).toBe(problem));
});

describe('runDeployCheck against a local target', () => {
  it('passes with connect skipped, counts files, leaves no probe', async () => {
    const target = tmp();
    writeFileSync(path.join(target, 'index.html'), 'x');
    const r = unwrap(await checkDeployTarget(deps(), publishCtx, envFor(target)));
    expect(r.passed).toBe(true);
    expect(r.checks.map((c) => [c.key, c.outcome])).toEqual([['connect', 'skipped'], ['targetDir', 'ok'], ['writable', 'ok'], ['targetFiles', 'ok']]);
    expect(r.filesAtTarget).toEqual(['index.html']);
    expect(readdirSync(target)).toEqual(['index.html']);
  });

  it('names a missing directory and does not run the rest', async () => {
    const r = unwrap(await checkDeployTarget(deps(), publishCtx, envFor(path.join(tmp(), 'vertippt'))));
    expect(r.passed).toBe(false);
    expect(r.checks).toEqual([
      { key: 'connect', outcome: 'skipped' },
      { key: 'targetDir', outcome: 'failed', problem: 'targetMissing' },
      { key: 'writable', outcome: 'notRun' },
      { key: 'targetFiles', outcome: 'notRun' },
    ]);
  });

  it('reports a read-only directory as not writable', async () => {
    const target = tmp();
    chmodSync(target, 0o555);
    const r = unwrap(await checkDeployTarget(deps(), publishCtx, envFor(target)));
    expect(r.checks[2]).toEqual({ key: 'writable', outcome: 'failed', problem: 'notWritable' });
  });

  it('builds nothing and finishes in seconds, steps are the four checks', async () => {
    const env = envFor(tmp());
    const started = Date.now();
    unwrap(await checkDeployTarget(deps(), publishCtx, env));
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(lastRecord(env, 'deployCheck').steps.map((s) => [s.key, s.state])).toEqual([['connect', 'skipped'], ['targetDir', 'done'], ['writable', 'done'], ['targetFiles', 'done']]);
    expect(readdirSync(env.cacheDir)).not.toContain('preview-build.json');
  });

  it('fails the write check when the probe file stays behind', async () => {
    const target = tmp();
    const env = envFor(target);
    const d = deps();
    const handle = beginRun(env, d.clock, { kind: 'deployCheck', source: 'ui', userId: 'USER-TEST', runId: 'RUN1' });
    if ('busy' in handle) throw new Error('busy');
    // Das Löschen der Probe tut so, als gelänge es, und lässt die Datei liegen.
    const io: DeployCheckIo = {
      rsync: ({ command, args }, opts) => (args.includes('--delete') ? Promise.resolve({ code: 0, log: '' }) : runChild(command, args, opts)),
    };
    try {
      const r = unwrap(await runDeployCheck(handle, env, env.deploy, io));
      expect(r.passed).toBe(false);
      expect(r.checks[2]).toEqual({ key: 'writable', outcome: 'failed', problem: 'probeLeft' });
      expect(r.log).toContain('.kompass-probe-');
      expect(r.filesAtTarget).toEqual([]);
    } finally {
      endRun(env, 'RUN1');
    }
  });
});

describe('rsyncWith', () => {
  it('keeps auth flags for key and password targets', () => {
    expect(rsyncWith({ host: 'h', user: 'u', path: '/www', auth: { kind: 'key', keyFile: '/k' } }, ['--list-only'], ['u@h:'])).toEqual({ command: 'rsync', args: ['--list-only', '-e', expect.stringContaining('-i /k'), 'u@h:'] });
    expect(rsyncWith({ host: 'h', user: 'u', path: '/www', auth: { kind: 'password', passwordFile: '/p' } }, ['--list-only'], ['u@h:']).command).toBe('sshpass');
  });
});
