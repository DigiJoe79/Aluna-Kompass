import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { conflict, invalid, isoNow, ok, requirePermission, type CallContext, type Deps, type Result } from '@kompass/core';
import { exportSiteContent, type SiteExport } from '../export';
import { lastSuccessfulPublish, recordPublish, type PublishDiff, type PublishRecord } from '../services/publishes';
import { buildSite, SiteBuildError } from './build';
import { copyTree } from './copy';
import { diffTrees, hashTree } from './diff';
import type { SiteEnv } from './env';
import { prepareImageVariants } from './images';
import { rsyncPublish } from './publish';

export interface PreviewResult {
  contentHash: string;
  gaps: SiteExport['gaps'];
  violations: SiteExport['violations'];
  diff: PublishDiff;
  previewDir: string;
  log: string;
}

export interface PublishResult {
  status: 'success';
  record: PublishRecord;
  diff: PublishDiff;
  log: string;
}

/**
 * Schreibt jeden Schritt mit Dauer nach stdout und bricht ab, wenn einer
 * haengt. Ohne das steht die Oberflaeche im Fehlerfall beliebig lange auf
 * „wird erstellt", und im Containerprotokoll steht nichts.
 */
async function step<T>(name: string, limitMs: number, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.log(`[site] ${name} …`);
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError(name, limitMs)), limitMs);
      }),
    ]);
    console.log(`[site] ${name} fertig nach ${Date.now() - started} ms`);
    return value;
  } catch (error) {
    // „fertig" gehoert nur an einen geglueckten Schritt. Beim Zeitlimit laeuft
    // die urspruengliche Arbeit weiter und belegt einen Worker im Threadpool.
    const reason = error instanceof StepTimeoutError ? 'Zeitlimit überschritten' : 'fehlgeschlagen';
    console.log(`[site] ${name} ${reason} nach ${Date.now() - started} ms`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class StepTimeoutError extends Error {
  constructor(public readonly step: string, limitMs: number) {
    super(`Schritt „${step}" hat das Zeitlimit von ${Math.round(limitMs / 1000)} s überschritten`);
    this.name = 'StepTimeoutError';
  }
}

async function exportAndBuild(
  deps: Deps,
  ctx: CallContext,
  env: SiteEnv,
  outDir: string,
): Promise<Result<{ exported: SiteExport; log: string; manifest: Record<string, string>; diff: PublishDiff }>> {
  const publicUrl = env.publicUrl;
  if (!publicUrl) return conflict('publicUrlMissing', 'SITE_PUBLIC_URL ist nicht gesetzt');
  const job = await mkdtemp(path.join(tmpdir(), 'kompass-site-'));
  try {
    const exported = await step('Inhalt exportieren', 120_000, () => exportSiteContent(deps, ctx, { jobDir: job }));
    if (!exported.ok) return exported;
    await step('Bildvarianten', 600_000, () =>
      prepareImageVariants({ jobDir: job, assets: exported.value.assets, cacheDir: env.cacheDir }),
    );
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const { log } = await step('Site bauen', 600_000, () =>
      buildSite({ siteDir: env.siteDir, contentDir: job, outDir, publicUrl, staging: env.staging }),
    );
    await step('Bilder uebernehmen', 120_000, async () => {
      try {
        await copyTree(path.join(job, 'images'), path.join(outDir, 'images'));
      } catch {
        // ignore if no images
      }
    });
    const manifest = await step('Pruefsummen', 300_000, () => hashTree(outDir));
    const last = lastSuccessfulPublish(deps, deps.env);
    const previous = last ? (JSON.parse(last.fileManifest) as Record<string, string>) : {};
    return ok({ exported: exported.value, log, manifest, diff: diffTrees(previous, manifest) });
  } catch (error) {
    if (error instanceof SiteBuildError) return conflict('siteBuildFailed', error.log.slice(-4000) || error.message);
    if (error instanceof StepTimeoutError) return conflict('siteBuildFailed', error.message);
    throw error;
  } finally {
    await rm(job, { recursive: true, force: true });
  }
}

export async function runPreview(deps: Deps, ctx: CallContext, env: SiteEnv): Promise<Result<PreviewResult>> {
  const denied = requirePermission(ctx, 'website.publish');
  if (denied) return denied;
  const built = await exportAndBuild(deps, ctx, env, env.previewDir);
  if (!built.ok) return built;
  return ok({
    contentHash: built.value.exported.contentHash,
    gaps: built.value.exported.gaps,
    violations: built.value.exported.violations,
    diff: built.value.diff,
    previewDir: env.previewDir,
    log: built.value.log,
  });
}

export async function runPublish(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { confirm: boolean }): Promise<Result<PublishResult>> {
  const denied = requirePermission(ctx, 'website.publish');
  if (denied) return denied;
  if (!opts.confirm) return invalid([{ path: 'confirm', message: 'confirmationRequired' }]);
  if (deps.env === 'development') return conflict('publishNotAllowedHere', 'Aus der Entwicklungsumgebung wird nicht publiziert');
  if (!env.deploy) return conflict('publishTargetMissing', 'SITE_DEPLOY_* ist nicht gesetzt');
  const startedAt = isoNow(deps.clock);
  const outDir = await mkdtemp(path.join(tmpdir(), 'kompass-publish-'));
  try {
    const built = await exportAndBuild(deps, ctx, env, outDir);
    if (!built.ok) return built;
    if (built.value.exported.violations.length > 0) {
      recordPublish(deps, ctx, {
        environment: deps.env,
        startedAt,
        status: 'aborted',
        contentHash: built.value.exported.contentHash,
        diff: built.value.diff,
        fileManifest: {},
        log: JSON.stringify(built.value.exported.violations),
        summary: 'Publish abgebrochen: Sperrworttreffer',
      });
      return conflict('blockedTermsPresent', `${built.value.exported.violations.length} Sperrworttreffer`);
    }
    try {
      const { log } = await step('Uebertragen', 600_000, () => rsyncPublish({ distDir: outDir, deploy: env.deploy! }));
      const record = recordPublish(deps, ctx, {
        environment: deps.env,
        startedAt,
        status: 'success',
        contentHash: built.value.exported.contentHash,
        diff: built.value.diff,
        fileManifest: built.value.manifest,
        log: built.value.log + log,
        summary: `Publiziert: ${built.value.diff.changed.length} geändert, ${built.value.diff.added.length} neu, ${built.value.diff.removed.length} entfernt`,
      });
      return ok({ status: 'success', record, diff: built.value.diff, log });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordPublish(deps, ctx, {
        environment: deps.env,
        startedAt,
        status: 'failed',
        contentHash: built.value.exported.contentHash,
        diff: built.value.diff,
        fileManifest: {},
        log: message,
        summary: 'Publish fehlgeschlagen',
      });
      return conflict('publishFailed', message.slice(0, 2000));
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
