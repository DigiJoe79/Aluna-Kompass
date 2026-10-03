import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSite } from '../src/pipeline/build';
import { runChild } from '../src/pipeline/child';
import { rsyncPublish } from '../src/pipeline/publish';
import { JobAbortedError } from '../src/pipeline/step';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-child-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** `ps`-Zeile eines Prozesses (Status und Elternprozess) oder null, wenn es ihn nicht mehr gibt. */
const psLine = (pid: number): string | null => {
  try {
    return execFileSync('ps', ['-o', 'stat=,ppid=', '-p', String(pid)]).toString().trim() || null;
  } catch {
    return null;
  }
};
/**
 * Beendet heißt: weg oder Zombie. Ein Zombie belegt nichts mehr und kann nichts
 * mehr übertragen; abgeholt wird er vom Init (im Container `tini`, unter macOS
 * launchd), und das dauert unter Last. Der Test wartet darum bis zu 3 s und
 * nennt sonst den `ps`-Status — der Wackler vom 02./03.10. (nur unter
 * `verify:modul`) ließ sich unter reiner CPU-Last nicht nachstellen.
 */
const expectEnded = async (pid: number) => {
  const ended = () => !alive(pid) || (psLine(pid) ?? '').startsWith('Z');
  for (const t0 = Date.now(); Date.now() - t0 < 3_000; await sleep(50)) if (ended()) return;
  expect.fail(`Prozess ${pid} läuft nach dem Abbruch noch: ps stat,ppid = ${psLine(pid) ?? '—'}`);
};
const until = async (fn: () => boolean, ms = 8_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (fn()) return;
  throw new Error('Zeit um');
};
const parent = `const { spawn } = require('node:child_process');
  const g = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
  console.log('enkel ' + g.pid); setInterval(() => {}, 1000);`;

/** Ein Astro, das nur `body` ausführt; `process.argv` trägt `--outDir`. */
const fakeAstro = (body: string) => {
  const site = tmp();
  mkdirSync(path.join(site, 'node_modules', 'astro', 'bin'), { recursive: true });
  writeFileSync(path.join(site, 'node_modules', 'astro', 'bin', 'astro.mjs'), `import { mkdirSync, writeFileSync } from 'node:fs';\nconst out = process.argv[process.argv.indexOf('--outDir') + 1];\nmkdirSync(out, { recursive: true });\nwriteFileSync(out + '/index.html', 'x');\n${body}\n`);
  return site;
};

describe('runChild', () => {
  it('ends the whole group on abort, SIGKILL after 5 s for those ignoring SIGTERM', async () => {
    const ctl = new AbortController();
    let grandchild = 0;
    const run = runChild(process.execPath, ['-e', parent], {
      signal: ctl.signal,
      onLine: (l) => {
        const m = /^enkel (\d+)/.exec(l);
        if (m) grandchild = Number(m[1]);
      },
    });
    await until(() => grandchild > 0);
    ctl.abort(new JobAbortedError('cancelled', 'build'));
    await expect(run).rejects.toMatchObject({ name: 'JobAbortedError' });
    await expectEnded(grandchild); // der Riegel wird erst frei, wenn alles beendet ist
  }, 20_000);
});

describe('buildSite', () => {
  it('counts astro pages and passes its limit', async () => {
    const site = fakeAstro(`console.log('23:01:37   ├─ /index.html (+3ms) '); console.log('23:01:37   └─ /en/index.html (+2ms) '); console.log('23:01:37 [build] ✓ Completed in 49ms.');`);
    const pages: number[] = [];
    await buildSite({ siteDir: site, contentDir: tmp(), outDir: tmp(), publicUrl: 'https://x.example', staging: false, stageRoot: tmp(), onPage: (n) => pages.push(n) });
    expect(pages).toEqual([1, 2]);
    await expect(
      buildSite({ siteDir: fakeAstro('setInterval(() => {}, 1000)'), contentDir: tmp(), outDir: tmp(), publicUrl: 'https://x.example', staging: false, stageRoot: tmp(), timeoutMs: 200 }),
    ).rejects.toMatchObject({ name: 'SiteBuildError', message: 'site build timed out' });
  }, 30_000);
});

describe('rsyncPublish', () => {
  const local = (to: string) => ({ host: '', user: '', path: to, auth: { kind: 'none' as const } });

  it('counts transferred files', async () => {
    const from = tmp();
    mkdirSync(path.join(from, 'sub'));
    for (const f of ['a.html', 'b.html', 'sub/c.html']) writeFileSync(path.join(from, f), f);
    const to = tmp();
    const counts: number[] = [];
    await rsyncPublish({ distDir: from, deploy: local(to), onFile: (n) => counts.push(n) });
    expect(counts.at(-1)).toBe(3);
    expect(readdirSync(to).sort()).toEqual(['a.html', 'b.html', 'sub']);
  });

  it('kills a hanging rsync together with its children', async () => {
    const bin = tmp();
    const pidFile = path.join(tmp(), 'pid');
    writeFileSync(path.join(bin, 'rsync'), '#!/bin/sh\nsleep 60 &\necho $! > "$KOMPASS_TEST_PID"\nwait\n');
    chmodSync(path.join(bin, 'rsync'), 0o755);
    const saved = { PATH: process.env.PATH, KOMPASS_TEST_PID: process.env.KOMPASS_TEST_PID };
    process.env.PATH = `${bin}:${process.env.PATH}`;
    process.env.KOMPASS_TEST_PID = pidFile;
    try {
      const ctl = new AbortController();
      const run = rsyncPublish({ distDir: tmp(), deploy: local(tmp()), signal: ctl.signal });
      await until(() => {
        try {
          return Number(readFileSync(pidFile, 'utf8')) > 0;
        } catch {
          return false;
        }
      });
      const sleeper = Number(readFileSync(pidFile, 'utf8'));
      ctl.abort(new JobAbortedError('cancelled', 'transfer'));
      await expect(run).rejects.toMatchObject({ name: 'JobAbortedError' });
      await expectEnded(sleeper);
    } finally {
      process.env.PATH = saved.PATH;
      if (saved.KOMPASS_TEST_PID === undefined) delete process.env.KOMPASS_TEST_PID;
      else process.env.KOMPASS_TEST_PID = saved.KOMPASS_TEST_PID;
    }
  }, 20_000);
});
