import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { conflict, invalid, isoNow, ok, requirePermission, type CallContext, type Deps, type Result } from '@kompass/core';
import { exportSiteContent, type SiteContentExport } from '../export';
import { lastSuccessfulPublish, recordPublish, type PublishDiff, type PublishRecord } from '../services/publishes';
import { buildSite, SiteBuildError } from './build';
import { copyTree } from './copy';
import { diffTrees, hashTree } from './diff';
import type { SiteEnv } from './env';
import { prepareImageVariants } from './images';
import { checkDeployCredentials, rsyncPublish } from './publish';

export interface PreviewResult {
  contentHash: string;
  gaps: SiteContentExport['gaps'];
  violations: SiteContentExport['violations'];
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
 * „wird erstellt“, und im Containerprotokoll steht nichts.
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
    // „fertig“ gehoert nur an einen geglueckten Schritt. Beim Zeitlimit laeuft
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
    super(`Schritt „${step}“ hat das Zeitlimit von ${Math.round(limitMs / 1000)} s überschritten`);
    this.name = 'StepTimeoutError';
  }
}

/**
 * Es läuft höchstens ein Vorschau- oder Publish-Lauf je Prozess. Zwei Läufe
 * räumten dasselbe Vorschauverzeichnis gleichzeitig ab und schrieben denselben
 * Stempel; der zweite meldet deshalb den ersten, statt zu warten.
 */
export interface RunningSiteJob {
  /** `preview` oder `publish`; die Oberfläche übersetzt. */
  name: string;
  startedAt: string;
}

/**
 * Der Zustand liegt als Datei im Cache, nicht in einer Modulvariablen: Next
 * bündelt dieses Modul je Route, und der Route Handler, der den Zustand
 * abfragt, sähe eine andere Instanz als die Server Action, die baut. Die
 * Prozessnummer steht dabei, damit eine Datei aus einem abgestürzten Prozess
 * nicht als laufender Job gilt.
 */
const jobFile = (env: SiteEnv) => path.join(env.cacheDir, 'running-job.json');

/** Was gerade läuft und seit wann — für die Anzeige, auch nach dem Neuladen. */
export function currentSiteJob(env: SiteEnv): RunningSiteJob | null {
  try {
    const job = JSON.parse(readFileSync(jobFile(env), 'utf8')) as RunningSiteJob & { pid: number };
    if (job.pid !== process.pid) return null;
    return { name: job.name, startedAt: job.startedAt };
  } catch {
    return null;
  }
}

async function exclusive<T>(deps: Deps, env: SiteEnv, name: string, run: () => Promise<Result<T>>): Promise<Result<T>> {
  // Prüfen und Schreiben ohne await dazwischen, sonst kämen zwei Aufrufe
  // gleichzeitig an der Prüfung vorbei.
  const running = currentSiteJob(env);
  if (running) return conflict('siteJobRunning', `Es läuft bereits: ${running.name}`);
  mkdirSync(env.cacheDir, { recursive: true });
  writeFileSync(jobFile(env), JSON.stringify({ name, startedAt: isoNow(deps.clock), pid: process.pid }));
  try {
    return await run();
  } finally {
    rmSync(jobFile(env), { force: true });
  }
}

/** Steht im Protokoll, wenn ein Publish den Vorschau-Build uebernommen hat. */
export const REUSED_PREVIEW = 'Vorschau uebernommen, nicht neu gebaut.';

/** Neueste Aenderung im Template — ohne node_modules und Baureste. */
async function newestTemplateChange(dir: string): Promise<number> {
  const skip = new Set(['node_modules', '.astro', 'dist', '.git']);
  let newest = 0;
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const { mtimeMs } = await stat(full);
      if (mtimeMs > newest) newest = mtimeMs;
    }
  };
  await walk(dir);
  return newest;
}

interface PreviewStamp {
  contentHash: string;
  publicUrl: string;
  staging: boolean;
  /** Stand des Templates zum Bauzeitpunkt; ein bearbeitetes Template macht die Vorschau ungueltig. */
  templateChangedAt: number;
}

const stampFile = (env: SiteEnv) => path.join(env.cacheDir, 'preview-build.json');

async function readStamp(env: SiteEnv): Promise<PreviewStamp | null> {
  try {
    return JSON.parse(await readFile(stampFile(env), 'utf8')) as PreviewStamp;
  } catch {
    return null;
  }
}

async function exportAndBuild(
  deps: Deps,
  ctx: CallContext,
  env: SiteEnv,
  outDir: string,
): Promise<Result<{ exported: SiteContentExport; log: string; manifest: Record<string, string>; diff: PublishDiff }>> {
  const publicUrl = env.publicUrl;
  if (!publicUrl) return conflict('publicUrlMissing', 'SITE_PUBLIC_URL ist nicht gesetzt');
  const job = await mkdtemp(path.join(tmpdir(), 'kompass-site-'));
  try {
    const exported = await step('Inhalt exportieren', 120_000, () =>
      exportSiteContent(deps, ctx, { jobDir: job, templateDir: env.templateDir }),
    );
    if (!exported.ok) return exported;
    await step('Bildvarianten', 600_000, () =>
      prepareImageVariants({ jobDir: job, assets: exported.value.assets, cacheDir: env.cacheDir }),
    );
    const stamp: PreviewStamp = {
      contentHash: exported.value.contentHash,
      publicUrl,
      staging: env.staging,
      templateChangedAt: await newestTemplateChange(env.templateDir),
    };
    const toPreview = path.resolve(outDir) === path.resolve(env.previewDir);
    const lastBuild = await readStamp(env);
    // Der uebliche Ablauf ist Vorschau ansehen, dann publizieren — zweimal
    // dasselbe zu bauen kostet auf dem NAS Minuten. Uebernommen wird nur, wenn
    // Inhalt, Zieladresse, Staging-Schalter *und* der Stand des Templates
    // unveraendert sind; Letzteres, weil ein bearbeitetes `.astro` den
    // Inhalts-Hash nicht beruehrt.
    const reusable =
      !toPreview &&
      lastBuild !== null &&
      lastBuild.contentHash === stamp.contentHash &&
      lastBuild.publicUrl === stamp.publicUrl &&
      lastBuild.staging === stamp.staging &&
      lastBuild.templateChangedAt === stamp.templateChangedAt &&
      existsSync(path.join(env.previewDir, 'index.html'));

    let log: string;
    if (reusable) {
      await mkdir(outDir, { recursive: true });
      await copyTree(env.previewDir, outDir);
      log = `${REUSED_PREVIEW}\n`;
    } else {
      await rm(outDir, { recursive: true, force: true });
      await mkdir(outDir, { recursive: true });
      ({ log } = await step('Site bauen', 600_000, () =>
        buildSite({ siteDir: env.templateDir, contentDir: job, outDir, publicUrl, staging: env.staging }),
      ));
      if (toPreview) await writeFile(stampFile(env), JSON.stringify(stamp), 'utf8');
    }
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
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  return exclusive(deps, env, 'preview', async () => {
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
  });
}

export interface DeployCheckResult {
  /** Das Ziel, wie rsync es anspricht — user@host:pfad oder ein lokaler Pfad. */
  target: string;
  /** Dateien, die am Ziel liegen und die ein Publish entfernen wuerde. */
  filesAtTarget: string[];
  log: string;
}

/**
 * Faehrt einen Trockenlauf gegen das eingestellte Ziel, ohne etwas zu
 * uebertragen: die Anmeldung wird wirklich versucht, und `--delete` listet
 * gegen ein leeres Quellverzeichnis auf, was dort liegt.
 *
 * Der Schutz, um den es geht, ist ein Tippfehler in SITE_DEPLOY_PATH — rsync
 * scheitert daran nicht, ein falscher Pfad zeigt einfach ins Leere. Die Liste
 * ist deshalb das Ergebnis: steht die erwartete Installation darin, stimmt der
 * Pfad; ist sie leer, zeigt er woandershin.
 */
export async function checkDeployTarget(deps: Deps, ctx: CallContext, env: SiteEnv): Promise<Result<DeployCheckResult>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  if (!env.deploy) return conflict('publishTargetMissing', 'SITE_DEPLOY_* ist nicht gesetzt');
  const credentialProblem = await checkDeployCredentials(env.deploy);
  if (credentialProblem) return conflict('deployCredentialsUnusable', credentialProblem);
  const emptyDir = await mkdtemp(path.join(tmpdir(), 'kompass-deploy-check-'));
  try {
    const { log } = await rsyncPublish({ distDir: emptyDir, deploy: env.deploy, dryRun: true, timeoutMs: 60_000 });
    return ok({
      target: env.deploy.host ? `${env.deploy.user}@${env.deploy.host}:${env.deploy.path}` : env.deploy.path,
      // Verzeichniszeilen enden auf "/" und zaehlen nicht als Datei.
      filesAtTarget: log
        .split('\n')
        .flatMap((line) => (line.startsWith('*deleting ') ? [line.slice('*deleting '.length).trim()] : []))
        .filter((entry) => entry.length > 0 && !entry.endsWith('/')),
      log,
    });
  } catch (error) {
    return conflict('deployCheckFailed', (error instanceof Error ? error.message : String(error)).slice(0, 2000));
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
}

export async function runPublish(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { confirm: boolean }): Promise<Result<PublishResult>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  if (!opts.confirm) return invalid([{ path: 'confirm', message: 'confirmationRequired' }]);
  if (deps.env === 'development') return conflict('publishNotAllowedHere', 'Aus der Entwicklungsumgebung wird nicht publiziert');
  if (!env.deploy) return conflict('publishTargetMissing', 'SITE_DEPLOY_* ist nicht gesetzt');
  const credentialProblem = await checkDeployCredentials(env.deploy);
  if (credentialProblem) return conflict('deployCredentialsUnusable', credentialProblem);
  return exclusive(deps, env, 'publish', async () => {
    const startedAt = isoNow(deps.clock);
    const outDir = await mkdtemp(path.join(tmpdir(), 'kompass-publish-'));
    try {
      const built = await exportAndBuild(deps, ctx, env, outDir);
      if (!built.ok) {
        // Auch ein Abbruch vor dem Build ist ein Versuch: Wer nachsieht, warum
        // gestern nichts publiziert wurde, soll ihn in der Historie finden.
        const reason = built.error.type === 'conflict' ? built.error.code : built.error.type;
        recordPublish(deps, ctx, {
          environment: deps.env,
          startedAt,
          status: 'aborted',
          contentHash: '',
          diff: { changed: [], added: [], removed: [] },
          fileManifest: {},
          log: JSON.stringify(built.error),
          summary: `Publish abgebrochen: ${reason}`,
        });
        return built;
      }
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
        return ok({ status: 'success' as const, record, diff: built.value.diff, log });
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
  });
}
