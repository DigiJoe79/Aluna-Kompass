import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { conflict, ok, recordAudit, requirePermission, type CallContext, type Deps, type Result } from '@kompass/core';
import type { SiteEnv } from './env';
import { runningSiteJob } from './run-state';

export interface SiteCacheStatus {
  images: { count: number; bytes: number; oldest: string | null; newest: string | null };
  preview: { bytes: number; builtAt: string | null };
}

const stamp = (env: SiteEnv) => path.join(env.cacheDir, 'preview-build.json');

/** Bildvarianten: `*.webp` direkt im Cache; Temp-Dateien eines abgebrochenen Laufs (`*.tmp-*`) zählen nicht. */
function variantFiles(env: SiteEnv): string[] {
  try {
    return readdirSync(env.cacheDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.webp'))
      .map((e) => path.join(env.cacheDir, e.name));
  } catch {
    return [];
  }
}

function treeFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? treeFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  } catch {
    return [];
  }
}

/** Stand von Bild-Cache und Vorschau — nur lesen. Synchron, damit es neben dem Lauf-Riegel nichts verpasst. */
export function siteCacheStatus(deps: Deps, ctx: CallContext, env: SiteEnv): Result<SiteCacheStatus> {
  void deps;
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const stats = variantFiles(env).map((f) => statSync(f));
  const times = stats.map((s) => s.mtimeMs);
  const iso = (ms: number) => new Date(ms).toISOString();
  return ok({
    images: {
      count: stats.length,
      bytes: stats.reduce((sum, s) => sum + s.size, 0),
      oldest: times.length ? iso(Math.min(...times)) : null,
      newest: times.length ? iso(Math.max(...times)) : null,
    },
    preview: {
      bytes: treeFiles(env.previewDir).reduce((sum, f) => sum + statSync(f).size, 0),
      builtAt: existsSync(stamp(env)) ? statSync(stamp(env)).mtime.toISOString() : null,
    },
  });
}

/**
 * Leert Bildvarianten, Vorschau und Vorschau-Stempel. Die Ergebnisdateien der
 * Läufe und der Riegel bleiben. Läuft ein Lauf, geschieht nichts. Prüfen und
 * Löschen ohne await dazwischen — wie der Riegel in `jobs.ts` —, damit kein
 * zugleich gestarteter Lauf dazwischenkommt.
 */
export function clearSiteCache(deps: Deps, ctx: CallContext, env: SiteEnv): Result<{ removed: number }> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  if (runningSiteJob(env)) return conflict('siteJobRunning', 'Es läuft bereits ein Lauf');
  const files = [...variantFiles(env), ...treeFiles(env.previewDir), ...(existsSync(stamp(env)) ? [stamp(env)] : [])];
  for (const f of files) rmSync(f, { force: true });
  try {
    for (const e of readdirSync(env.previewDir, { withFileTypes: true })) rmSync(path.join(env.previewDir, e.name), { recursive: true, force: true });
  } catch {
    // kein Vorschauverzeichnis, nichts zu räumen
  }
  deps.db.transaction((tx) =>
    recordAudit(tx, deps, ctx, { action: 'site.cacheClear', entityType: 'siteCache', entityId: null, after: { removed: files.length }, params: { fileCount: files.length } }),
  );
  return ok({ removed: files.length });
}
