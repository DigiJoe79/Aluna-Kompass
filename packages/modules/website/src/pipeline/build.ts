import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

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
  const astroBin = await findAstroBin(opts.siteDir);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [astroBin, 'build', '--outDir', opts.outDir], {
      cwd: opts.siteDir,
      env: {
        ...process.env,
        SITE_CONTENT_DIR: opts.contentDir,
        SITE_PUBLIC_URL: opts.publicUrl,
        SITE_STAGING: opts.staging ? '1' : '0',
        NODE_ENV: 'production',
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SiteBuildError('site build timed out', log));
    }, opts.timeoutMs ?? 300_000);
    child.stdout.on('data', (c: Buffer) => {
      log += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      log += c.toString('utf8');
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
