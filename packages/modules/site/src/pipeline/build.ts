import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ChildTimeoutError, runChild } from './child';
import { copyTree } from './copy';
import { removeQuietly } from './step';

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

const ALLOWED = ['PATH', 'HOME', 'TMPDIR', 'TZ', 'LANG', 'LANGUAGE'];
/**
 * Astro führt Code des Templates aus und braucht keine Geheimnisse der
 * Anwendung (SESSION_SECRET, SITE_DEPLOY_*, Datenpfade) — B18.
 */
export function astroEnv(parent: NodeJS.ProcessEnv, vars: { contentDir: string; publicUrl: string; staging: boolean }): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(Object.entries(parent).filter(([k, v]) => v !== undefined && (ALLOWED.includes(k) || k.startsWith('LC_'))));
  return { ...kept, NODE_ENV: 'production', SITE_CONTENT_DIR: vars.contentDir, SITE_PUBLIC_URL: vars.publicUrl, SITE_STAGING: vars.staging ? '1' : '0', FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' };
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

/** Eine Routenzeile von Astro: `23:01:37   ├─ /index.html (+8ms)` — mit Uhrzeit vorweg, gezählt wird jede Route (auch robots.txt). */
export const ASTRO_PAGE = /^(?:\d{2}:\d{2}:\d{2})?\s*[├└]─ \S+ \(\+\d+/;

export async function buildSite(opts: {
  siteDir: string;
  contentDir: string;
  outDir: string;
  publicUrl: string;
  staging: boolean;
  /** Verzeichnis im Cache, in dem Astro baut (`cwd`); die Ausgabe liegt darin. */
  stageRoot: string;
  /** Ohne Angabe gibt es kein eigenes Zeitlimit; der Schritt des Laufs hat eines. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onPage?: (pages: number) => void;
}): Promise<{ log: string }> {
  const siteDir = path.resolve(opts.siteDir);
  const outDir = path.resolve(opts.outDir);
  const contentDir = path.resolve(opts.contentDir);
  const astroBin = await findAstroBin(siteDir);
  // Astro legt Zwischenstände unter <cwd>/.astro ab, wenn --outDir außerhalb von
  // cwd liegt, und verschiebt sie per rename — über Dateisystemgrenzen scheitert
  // das mit EXDEV. Deshalb läuft Astro mit cwd = Bauverzeichnis im Cache und
  // --root = Template: Die Ausgabe liegt dann innerhalb von cwd, und nichts
  // davon landet unter /data und im Backup (B13).
  const stageRoot = path.resolve(opts.stageRoot);
  await mkdir(stageRoot, { recursive: true });
  const stage = await mkdtemp(path.join(stageRoot, 'out-'));
  try {
    const result = await runAstro(astroBin, siteDir, stage, contentDir, stageRoot, opts);
    await mkdir(outDir, { recursive: true });
    await copyTree(stage, outDir, { signal: opts.signal });
    return result;
  } finally {
    await removeQuietly(stage);
  }
}

async function runAstro(
  astroBin: string,
  siteDir: string,
  outDir: string,
  contentDir: string,
  stageRoot: string,
  opts: { publicUrl: string; staging: boolean; timeoutMs?: number; signal?: AbortSignal; onPage?: (pages: number) => void },
): Promise<{ log: string }> {
  let pages = 0;
  try {
    const { code, log } = await runChild(process.execPath, [astroBin, 'build', '--root', siteDir, '--outDir', outDir], {
      cwd: stageRoot,
      env: astroEnv(process.env, { contentDir, publicUrl: opts.publicUrl, staging: opts.staging }),
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      clean: stripAnsi,
      onLine: (line) => {
        if (ASTRO_PAGE.test(line)) opts.onPage?.(++pages);
      },
    });
    if (code !== 0) throw new SiteBuildError(`astro build exited with ${code}`, log);
    return { log };
  } catch (error) {
    if (error instanceof ChildTimeoutError) throw new SiteBuildError('site build timed out', error.log);
    throw error;
  }
}

/** Reste aus Fassungen bis 0.2.4, die unter dem Template bauten. */
export async function removeLegacyStages(siteDir: string): Promise<number> {
  const dir = path.join(siteDir, '.astro');
  const names = await readdir(dir).catch(() => [] as string[]);
  const stale = names.filter((n) => n.startsWith('out-'));
  await Promise.all(stale.map((n) => rm(path.join(dir, n), { recursive: true, force: true, maxRetries: 3 })));
  return stale.length;
}
