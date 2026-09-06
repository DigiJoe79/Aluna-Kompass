import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { copyTree } from './copy';

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*[a-zA-Z]/g;

/** Entfernt Farb- und Cursor-Sequenzen, damit Protokolle lesbar bleiben. */
export const stripAnsi = (text: string): string => text.replace(ANSI, '');

export class SiteBuildError extends Error {
  constructor(message: string, public readonly log: string) {
    super(message);
    this.name = 'SiteBuildError';
  }
}

async function findAstroBin(siteDir: string): Promise<string> {
  const candidates = [
    path.join(siteDir, 'node_modules', 'astro', 'bin', 'astro.mjs'),
    path.join(siteDir, 'node_modules', 'astro', 'astro.js'),
    path.join(siteDir, 'node_modules', '.bin', 'astro'),
  ];
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {
      // try next
    }
  }
  throw new SiteBuildError(`astro not installed in ${siteDir}`, '');
}

export async function buildSite(opts: {
  siteDir: string;
  contentDir: string;
  outDir: string;
  publicUrl: string;
  staging: boolean;
  timeoutMs?: number;
}): Promise<{ log: string }> {
  const siteDir = path.resolve(opts.siteDir);
  const outDir = path.resolve(opts.outDir);
  const contentDir = path.resolve(opts.contentDir);
  const astroBin = await findAstroBin(siteDir);
  // Astro legt Zwischenstaende unter <siteDir>/.astro ab und verschiebt sie
  // anschliessend ins Ausgabeverzeichnis. Liegt dieses auf einem anderen
  // Dateisystem — im Container ist /data ein Volume, /app nicht —, scheitert
  // das mit EXDEV. Deshalb wird neben .astro gebaut und danach kopiert.
  const stageRoot = path.join(siteDir, '.astro');
  await mkdir(stageRoot, { recursive: true });
  const stage = await mkdtemp(path.join(stageRoot, 'out-'));
  try {
    const result = await runAstro(astroBin, siteDir, stage, contentDir, opts);
    await mkdir(outDir, { recursive: true });
    await copyTree(stage, outDir);
    return result;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function runAstro(
  astroBin: string,
  siteDir: string,
  outDir: string,
  contentDir: string,
  opts: { publicUrl: string; staging: boolean; timeoutMs?: number },
): Promise<{ log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [astroBin, 'build', '--outDir', outDir], {
      cwd: siteDir,
      env: {
        ...process.env,
        SITE_CONTENT_DIR: contentDir,
        SITE_PUBLIC_URL: opts.publicUrl,
        SITE_STAGING: opts.staging ? '1' : '0',
        NODE_ENV: 'production',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SiteBuildError('site build timed out', log));
    }, opts.timeoutMs ?? 300_000);
    child.stdout.on('data', (c: Buffer) => {
      log += stripAnsi(c.toString('utf8'));
    });
    child.stderr.on('data', (c: Buffer) => {
      log += stripAnsi(c.toString('utf8'));
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new SiteBuildError(e.message, log));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ log });
      else reject(new SiteBuildError(`astro build exited with ${code}`, log));
    });
  });
}
