import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { conflict, invalid, isoNow, localizedConflict, systemContext, newId, ok, recordAudit, requirePermission, validate, type CallContext, type Clock, type Deps, type Result, type ServiceError } from '@kompass/core';
import { z } from 'zod';
import { exportSiteContent, type SiteContentExport } from '../export';
import { contentManifestOf } from '../public-content';
import { lastSuccessfulPublish, recordPublish, type PublishDiff, type PublishRecord } from '../services/publishes';
import { buildSite, removeLegacyStages, SiteBuildError } from './build';
import { copyTree, countFiles, type TreeHooks } from './copy';
import { diffTrees, hashTree } from './diff';
import { runDeployCheck, type DeployCheckResult } from './deploy-check';
import { imageLimit, limitFor } from './limits';
import { SITE_CACHE_VERSION, type DeployTarget, type SiteEnv } from './env';
import { prepareImageVariants, type SkippedImage } from './images';
import { checkDeployCredentials, rsyncPublish } from './publish';
import { JobAbortedError, removeQuietly, step } from './step';
import { beginRun, endRun, requestCancel, resultFile, runningSiteJob, SITE_JOB_KINDS, SITE_JOB_TMP_PREFIX, workRoot, writeJsonAtomic, type RunHandle, type SiteJobKind, type SiteJobRun, type SiteJobStep, type StepKey } from './run-state';

export interface PreviewResult {
  contentHash: string;
  gaps: SiteContentExport['gaps'];
  violations: SiteContentExport['violations'];
  stale: SiteContentExport['stale'];
  pendingReview: SiteContentExport['pendingReview'];
  diff: PublishDiff;
  previewDir: string;
  log: string;
  /** Bilder, die sich nicht lesen ließen — der Bau ging ohne sie weiter. */
  skippedImages: SkippedImage[];
}

export interface PublishResult {
  status: 'success';
  record: PublishRecord;
  diff: PublishDiff;
  log: string;
  skippedImages: SkippedImage[];
}

export { SITE_JOB_KINDS, STEPS, beginRun, endRun, requestCancel, runningSiteJob, siteProcessToken, writeJsonAtomic } from './run-state';
export { SITE_JOB_TMP_PREFIX, workRoot } from './run-state';
export type { RunHandle, SiteJobKind, SiteJobRun, SiteJobStep, StepKey, StepState } from './run-state';

/**
 * Verstrichene Zeit fuer die Anzeige — aus derselben Uhr wie `startedAt`,
 * nicht aus der Uhr im Browser. Die ging bei einer Vorstandstestung
 * unbemerkt 21s falsch; die Oberflaeche zeigte prompt 21s statt 0.
 */
export function siteJobElapsedMs(job: Pick<SiteJobRun, 'startedAt'>, clock: Clock): number {
  return Math.max(0, clock.now().getTime() - Date.parse(job.startedAt));
}

/**
 * Der letzte abgeschlossene Lauf einer Art, wie er im Cache liegt. Je Art eine
 * Datei neben dem Riegel: Den Lauf startet eine Server Action oder die
 * MCP-Route, abgefragt wird er aus einem Route Handler oder einem zweiten
 * MCP-Aufruf — jeder mit eigenem Modul-Bündel.
 */
export interface SiteJobRecord<T = unknown> {
  kind: SiteJobKind;
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** Wer ihn gestartet hat. */
  userId: string | null;
  status: 'success' | 'failed' | 'aborted' | 'interrupted';
  reason?: 'cancelled' | 'timeout';
  /** Bei `reason: 'timeout'`: die gerissene Grenze. */
  timeout?: { limitMs: number; stalled: boolean };
  lastStep?: StepKey;
  /** Endstand der Schritte. */
  steps: SiteJobStep[];
  result?: T;
  error?: ServiceError;
  /** Ein unterbrochener Publish wartet noch auf seinen Historieneintrag. */
  historyPending?: boolean;
}

export type SiteJobStart = { started: true; runId: string; startedAt: string } | { started: false; running: SiteJobRun };

const abortedConflict = (e: JobAbortedError) =>
  localizedConflict(e.reason === 'cancelled' ? 'jobCancelled' : 'stepTimedOut', `site.publish.job.errors.${e.reason === 'cancelled' ? 'jobCancelled' : 'stepTimedOut'}`, { step: e.step ?? 'export' });

/**
 * Ein Lauf unter dem Riegel, dessen Ausgang — Ergebnis, Fachfehler oder
 * technischer Fehler — als letzter Lauf seiner Art im Cache landet. Nimmt den
 * Riegel **ohne await davor**, damit `start*` ihn synchron hält, bevor es
 * antwortet.
 */
function launch<T>(
  deps: Deps,
  ctx: CallContext,
  env: SiteEnv,
  kind: SiteJobKind,
  source: 'ui' | 'mcp',
  body: (h: RunHandle) => Promise<Result<T>>,
): { busy: SiteJobRun } | { run: SiteJobRun; done: Promise<Result<T>> } {
  settleInterruptedPublish(deps, env);
  const begun = beginRun(env, deps.clock, { kind, source, userId: ctx.userId ?? '', apiTokenId: ctx.apiTokenId, runId: newId() });
  if ('busy' in begun) return begun;
  const h = begun;
  let stoppedAt: StepKey | undefined;
  const save = (outcome: Pick<SiteJobRecord<T>, 'status' | 'result' | 'error' | 'reason' | 'timeout'>) => {
    const lastStep = outcome.status === 'success' ? undefined : (h.run.steps.find((s) => s.state === 'running')?.key ?? stoppedAt);
    const record = { kind, runId: h.run.runId, startedAt: h.run.startedAt, finishedAt: isoNow(deps.clock), userId: ctx.userId, steps: h.run.steps, ...(lastStep ? { lastStep } : {}), ...outcome };
    writeJsonAtomic(resultFile(env, kind), record);
  };
  const done = (async () => {
    try {
      const result = await body(h);
      save(result.ok ? { status: 'success', result: result.value } : { status: 'failed', error: result.error });
      return result;
    } catch (error) {
      if (error instanceof JobAbortedError) {
        stoppedAt = error.step ?? undefined;
        const stopped = abortedConflict(error);
        save({ status: 'aborted', reason: error.reason, ...(error.limit ? { timeout: { limitMs: error.limit.ms, stalled: error.limit.stalled } } : {}), error: stopped.ok ? undefined : stopped.error });
        return stopped as Result<T>;
      }
      const failed = conflict(`${kind}Failed`, (error instanceof Error ? error.message : String(error)).slice(0, 2000));
      if (!failed.ok) save({ status: 'failed', error: failed.error });
      throw error;
    } finally {
      endRun(env, h.run.runId);
    }
  })();
  return { run: h.run, done };
}

async function runAndWait<T>(deps: Deps, ctx: CallContext, env: SiteEnv, kind: SiteJobKind, source: 'ui' | 'mcp', body: (h: RunHandle) => Promise<Result<T>>): Promise<Result<T>> {
  const started = launch(deps, ctx, env, kind, source, body);
  if ('busy' in started) return localizedConflict('siteJobRunning', 'errors.siteJobRunning', { kind: started.busy.kind });
  return started.done;
}

/**
 * Startet einen Lauf im Hintergrund und kehrt sofort zurück. Über MCP liefen
 * Check, Vorschau und Publish sonst in die Zeitüberschreitung des Clients
 * (01.10.): Sie bauen die Seite, und der erste Bau nach vielen neuen Bildern
 * erzeugt Tausende Varianten. Läuft schon etwas, meldet er das, statt zu warten.
 *
 * Der Lauf ist ein nicht abgewarteter Promise im Node-Prozess — wie der
 * Texterkennungs-Worker der Akte; `after()` hinge an der Antwort und taugt
 * nicht für Arbeit, die eine abgebrochene Anfrage überdauern soll.
 */
function startInBackground<T>(deps: Deps, ctx: CallContext, env: SiteEnv, kind: SiteJobKind, source: 'ui' | 'mcp', body: (h: RunHandle) => Promise<Result<T>>): Result<SiteJobStart> {
  const started = launch(deps, ctx, env, kind, source, body);
  if ('busy' in started) return ok({ started: false, running: started.busy });
  started.done.catch((error: unknown) => {
    console.error(`[site] ${kind} fehlgeschlagen`, error);
  });
  return ok({ started: true, runId: started.run.runId, startedAt: started.run.startedAt });
}

const siteJobResultSchema = z.object({ kind: z.enum(SITE_JOB_KINDS) });

const readResult = (env: SiteEnv, kind: SiteJobKind): SiteJobRecord | null => {
  try {
    return JSON.parse(readFileSync(resultFile(env, kind), 'utf8')) as SiteJobRecord;
  } catch {
    return null;
  }
};

/** Trägt den Historieneintrag eines unterbrochenen Publish nach — genau einmal. */
export function settleInterruptedPublish(deps: Deps, env: SiteEnv): void {
  runningSiteJob(env);
  const rec = readResult(env, 'publish');
  if (rec?.status !== 'interrupted' || !rec.historyPending) return;
  recordPublish(deps, { ...systemContext('site-interrupted'), userId: rec.userId || null }, {
    environment: deps.env,
    startedAt: rec.startedAt,
    status: 'aborted',
    contentHash: '',
    diff: { changed: [], added: [], removed: [] },
    fileManifest: {},
    log: `Unterbrochen im Schritt ${rec.lastStep ?? '–'}`,
    summary: 'Publish unterbrochen: Neustart während des Laufs',
  });
  writeJsonAtomic(resultFile(env, 'publish'), { ...rec, historyPending: false });
}

/**
 * Was gerade läuft und der letzte abgeschlossene Lauf einer Art — für alle
 * drei Hintergrundläufe derselbe Weg, damit ein Client nur eine Abfrage kennt.
 */
export function lastSiteJob(deps: Deps, ctx: CallContext, env: SiteEnv, input: unknown): Result<{ running: SiteJobRun | null; last: SiteJobRecord | null }> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  const parsed = validate(deps, siteJobResultSchema, input);
  if (!parsed.ok) return parsed;
  settleInterruptedPublish(deps, env);
  return ok({ running: runningSiteJob(env), last: readResult(env, parsed.value.kind) });
}

const cancelSchema = z.object({ runId: z.string().min(1) });

/**
 * Bricht den laufenden Lauf ab — bei einem Publish nur bis zum Beginn der
 * Übertragung. Der Lauf endet im nächsten Wächterschritt und hinterlässt ein
 * Ergebnis `aborted`; hier steht nur, dass jemand es verlangt hat.
 */
export function cancelSiteJob(deps: Deps, ctx: CallContext, env: SiteEnv, input: unknown): Result<{ cancelled: true }> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  const parsed = validate(deps, cancelSchema, input);
  if (!parsed.ok) return parsed;
  settleInterruptedPublish(deps, env);
  const run = runningSiteJob(env);
  if (!run || run.runId !== parsed.value.runId) return localizedConflict('jobNotRunning', 'site.publish.job.errors.jobNotRunning');
  const step = run.steps.find((s) => s.state === 'running')?.key ?? null;
  if (!run.cancellable || !requestCancel(run.runId)) return localizedConflict('jobNotCancellable', 'site.publish.job.errors.jobNotCancellable');
  deps.db.transaction((tx) =>
    recordAudit(tx, deps, ctx, { action: 'site.jobCancel', entityType: 'siteJob', entityId: run.runId, after: { kind: run.kind, step }, params: { kind: run.kind } }),
  );
  return ok({ cancelled: true as const });
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
  /** `SITE_CACHE_VERSION` zum Bauzeitpunkt; ein Stempel anderer Fassung gilt nicht. */
  cacheVersion: string;
}

const stampFile = (env: SiteEnv) => path.join(env.cacheDir, 'preview-build.json');

async function readStamp(env: SiteEnv): Promise<PreviewStamp | null> {
  try {
    const stamp = JSON.parse(await readFile(stampFile(env), 'utf8')) as PreviewStamp;
    if (stamp.cacheVersion === SITE_CACHE_VERSION) return stamp;
    await rm(stampFile(env), { force: true });
    return null;
  } catch {
    return null;
  }
}

/** Kopiert den Bildordner, wenn es einen gibt; nur „fehlt“ ist kein Fehler — alles andere hat früher still ein kaputtes Verzeichnis hinterlassen. */
export async function copyImagesIfAny(src: string, dest: string, hooks?: TreeHooks): Promise<void> {
  try {
    await stat(src);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await copyTree(src, dest, hooks);
}

async function exportAndBuild(
  deps: Deps,
  ctx: CallContext,
  env: SiteEnv,
  h: RunHandle,
  outDir: string,
  opts: { expectedContentHash?: string } = {},
): Promise<Result<{ exported: SiteContentExport; log: string; manifest: Record<string, string>; diff: PublishDiff; skippedImages: SkippedImage[] }>> {
  const publicUrl = env.publicUrl;
  if (!publicUrl) return conflict('publicUrlMissing', 'SITE_PUBLIC_URL ist nicht gesetzt');
  const job = await mkdtemp(path.join(workRoot(env), `${SITE_JOB_TMP_PREFIX}site-`));
  try {
    const first = await step(h, 'export', limitFor(env, 'export'), async (c) => {
      const result = await exportSiteContent(deps, ctx, { jobDir: job, templateDir: env.templateDir }, { signal: c.signal, onAsset: (d, t) => c.progress(d, t) });
      return { result, templateChangedAt: result.ok ? await newestTemplateChange(env.templateDir) : 0 };
    });
    const exported = first.result;
    if (!exported.ok) return exported;
    // Der Server baut den Hash selbst neu: Zwischen Vorschau und Klick kann sich
    // der Inhalt geändert haben, etwa per MCP (B14).
    const expected = opts.expectedContentHash;
    if (expected !== undefined && exported.value.contentHash !== expected) {
      return localizedConflict('previewOutdated', 'errors.site.previewOutdated', { expected: expected.slice(0, 12), actual: exported.value.contentHash.slice(0, 12) });
    }
    for (const s of exported.value.stale) console.log(`[site] veralteter Verweis: ${s.path} = ${s.value}`);
    const images = await step(h, 'images', limitFor(env, 'images'), (c) =>
      prepareImageVariants({
        jobDir: job,
        assets: exported.value.assets,
        cacheDir: env.cacheDir,
        signal: c.signal,
        onPlan: ({ total, missing }) => {
          c.setLimit(imageLimit(env, missing));
          c.progress(0, total, { generated: 0 });
        },
        onProgress: (d, t, g) => c.progress(d, t, { generated: g }),
      }),
    );
    const skippedImages = images.skipped;
    const imageLog = skippedImages.map((i) => `Bild übersprungen: ${i.filename}\n`).join('');
    const stamp: PreviewStamp = {
      contentHash: exported.value.contentHash,
      publicUrl,
      staging: env.staging,
      templateChangedAt: first.templateChangedAt,
      cacheVersion: SITE_CACHE_VERSION,
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
      log = await step(
        h,
        'build',
        limitFor(env, 'build'),
        async (c) => {
          await mkdir(outDir, { recursive: true });
          // Der Schritt steht von Anfang an auf „übersprungen“; das Kopieren zählt trotzdem, damit es nicht stumm wirkt.
          const total = await countFiles(env.previewDir);
          let copied = 0;
          c.progress(0, total);
          await copyTree(env.previewDir, outDir, { signal: c.signal, onFile: () => c.progress(++copied, total) });
          return `${REUSED_PREVIEW}\n`;
        },
        { startAs: 'skipped' },
      );
    } else {
      // Der Stempel zuerst: Bricht der Bau ab, steht im Verzeichnis ein halber
      // Stand, und der Stempel des vorigen darf ihn nicht für fertig erklären.
      if (toPreview) await rm(stampFile(env), { force: true });
      await rm(outDir, { recursive: true, force: true });
      await mkdir(outDir, { recursive: true });
      await removeLegacyStages(env.templateDir);
      ({ log } = await step(h, 'build', limitFor(env, 'build'), (c) => buildSite({ siteDir: env.templateDir, stageRoot: env.cacheDir, contentDir: job, outDir, publicUrl, staging: env.staging, signal: c.signal, timeoutMs: limitFor(env, 'build').totalMs, onPage: (n) => c.progress(n) })));
    }
    await step(h, 'copyImages', limitFor(env, 'copyImages'), async (c) => {
      const images = path.join(job, 'images');
      const total = await countFiles(images);
      c.progress(0, total);
      let n = 0;
      await copyImagesIfAny(images, path.join(outDir, 'images'), { signal: c.signal, onFile: () => c.progress(++n, total) });
    });
    // Erst jetzt ist die Vorschau vollständig, mit Bildern.
    if (toPreview) writeJsonAtomic(stampFile(env), stamp);
    const manifest = await step(h, 'checksums', limitFor(env, 'checksums'), async (c) => {
      const total = await countFiles(outDir);
      c.progress(0, total);
      let n = 0;
      return hashTree(outDir, { signal: c.signal, onFile: () => c.progress(++n, total) });
    });
    const last = lastSuccessfulPublish(deps, deps.env);
    const previous = last ? (JSON.parse(last.fileManifest) as Record<string, string>) : {};
    return ok({ exported: exported.value, log: imageLog + log, manifest, diff: diffTrees(previous, manifest), skippedImages });
  } catch (error) {
    if (error instanceof JobAbortedError) throw error;
    if (error instanceof SiteBuildError) return conflict('siteBuildFailed', error.log.slice(-4000) || error.message);
    throw error;
  } finally {
    await removeQuietly(job);
  }
}

/** Baut die Vorschau und wartet darauf — der Lauf, den `startPreview` im Hintergrund anstößt. */
export async function runPreview(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { source?: 'ui' | 'mcp' } = {}): Promise<Result<PreviewResult>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  return runAndWait(deps, ctx, env, 'preview', opts.source ?? 'ui', (h) => previewBody(deps, ctx, env, h));
}

/** Startet den Vorschau-Bau im Hintergrund; das Ergebnis liest `lastSiteJob` (`kind: preview`). */
export async function startPreview(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { source: 'ui' | 'mcp' }): Promise<Result<SiteJobStart>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  return startInBackground(deps, ctx, env, 'preview', opts.source, (h) => previewBody(deps, ctx, env, h));
}

async function previewBody(deps: Deps, ctx: CallContext, env: SiteEnv, h: RunHandle): Promise<Result<PreviewResult>> {
  const built = await exportAndBuild(deps, ctx, env, h, env.previewDir);
  if (!built.ok) return built;
  return ok({
    contentHash: built.value.exported.contentHash,
    gaps: built.value.exported.gaps,
    violations: built.value.exported.violations,
    stale: built.value.exported.stale,
    pendingReview: built.value.exported.pendingReview,
    diff: built.value.diff,
    previewDir: env.previewDir,
    log: built.value.log,
    skippedImages: built.value.skippedImages,
  });
}

export type { DeployCheckResult } from './deploy-check';

/**
 * Der Verbindungstest: Anmeldung, Zielverzeichnis, Schreibrecht (Probedatei
 * anlegen und löschen) und die Dateien am Ziel — nur mit rsync, ohne Export
 * und ohne Bau, in Sekunden. Siehe `runDeployCheck`.
 */
export async function checkDeployTarget(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { source?: 'ui' | 'mcp' } = {}): Promise<Result<DeployCheckResult>> {
  const deploy = await deployCheckTarget(ctx, env);
  if (!deploy.ok) return deploy;
  const target = deploy.value;
  return runAndWait(deps, ctx, env, 'deployCheck', opts.source ?? 'ui', (h) => runDeployCheck(h, env, target));
}

/** Startet den Verbindungstest im Hintergrund; das Ergebnis liest `lastSiteJob` (`kind: deployCheck`). */
export async function startDeployCheck(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { source: 'ui' | 'mcp' }): Promise<Result<SiteJobStart>> {
  const deploy = await deployCheckTarget(ctx, env);
  if (!deploy.ok) return deploy;
  const target = deploy.value;
  return startInBackground(deps, ctx, env, 'deployCheck', opts.source, (h) => runDeployCheck(h, env, target));
}

/** Recht, Ziel und Zugangsdaten — was ein Check vor dem Start klären kann. */
async function deployCheckTarget(ctx: CallContext, env: SiteEnv): Promise<Result<DeployTarget>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  if (!env.deploy) return conflict('publishTargetMissing', 'SITE_DEPLOY_* ist nicht gesetzt');
  const credentialProblem = await checkDeployCredentials(env.deploy);
  if (credentialProblem) return conflict('deployCredentialsUnusable', credentialProblem);
  return ok(env.deploy);
}

/** Baut, überträgt und protokolliert, und wartet darauf — der Lauf, den `startPublish` im Hintergrund anstößt. */
export async function runPublish(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { confirm: boolean; source?: 'ui' | 'mcp'; expectedContentHash?: string }): Promise<Result<PublishResult>> {
  const ready = await publishTarget(deps, ctx, env, opts);
  if (!ready.ok) return ready;
  return runAndWait(deps, ctx, env, 'publish', opts.source ?? 'ui', (h) => publishBody(deps, ctx, env, h, opts));
}

/**
 * Startet den Publish im Hintergrund; das Ergebnis liest `lastSiteJob`
 * (`kind: publish`). Was vor dem Start feststeht — Recht, Bestätigung,
 * Umgebung, Ziel, Zugangsdaten — kommt sofort als Fehler zurück.
 */
export async function startPublish(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { confirm: boolean; source: 'ui' | 'mcp'; expectedContentHash?: string }): Promise<Result<SiteJobStart>> {
  const ready = await publishTarget(deps, ctx, env, opts);
  if (!ready.ok) return ready;
  return startInBackground(deps, ctx, env, 'publish', opts.source, (h) => publishBody(deps, ctx, env, h, opts));
}

async function publishTarget(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { confirm: boolean }): Promise<Result<DeployTarget>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  if (opts?.confirm !== true) return invalid([{ path: 'confirm', message: 'confirmationRequired' }]);
  if (deps.env === 'development') return conflict('publishNotAllowedHere', 'Aus der Entwicklungsumgebung wird nicht publiziert');
  if (!env.deploy) return conflict('publishTargetMissing', 'SITE_DEPLOY_* ist nicht gesetzt');
  const credentialProblem = await checkDeployCredentials(env.deploy);
  if (credentialProblem) return conflict('deployCredentialsUnusable', credentialProblem);
  return ok(env.deploy);
}

async function publishBody(deps: Deps, ctx: CallContext, env: SiteEnv, h: RunHandle, opts: { expectedContentHash?: string }): Promise<Result<PublishResult>> {
  const startedAt = isoNow(deps.clock);
  const outDir = await mkdtemp(path.join(workRoot(env), `${SITE_JOB_TMP_PREFIX}publish-`));
  let contentHash = '';
  try {
    const built = await exportAndBuild(deps, ctx, env, h, outDir, { expectedContentHash: opts.expectedContentHash });
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
    contentHash = built.value.exported.contentHash;
    if (built.value.exported.violations.length > 0) {
      recordPublish(deps, ctx, {
        environment: deps.env,
        startedAt,
        status: 'aborted',
        contentHash,
        diff: built.value.diff,
        fileManifest: {},
        log: JSON.stringify(built.value.exported.violations),
        summary: 'Publish abgebrochen: Sperrworttreffer',
      });
      return conflict('blockedTermsPresent', `${built.value.exported.violations.length} Sperrworttreffer`);
    }
    // Ab hier ein Abbruch ließe die Webseite halb aktualisiert zurück.
    h.setCancellable(false);
    const total = built.value.diff.added.length + built.value.diff.changed.length;
    let transferLog: string;
    try {
      ({ log: transferLog } = await step(h, 'transfer', limitFor(env, 'transfer'), (c) => rsyncPublish({ distDir: outDir, deploy: env.deploy!, signal: c.signal, onFile: (n) => c.progress(Math.min(n, total), total) })));
    } catch (error) {
      if (error instanceof JobAbortedError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      recordPublish(deps, ctx, {
        environment: deps.env,
        startedAt,
        status: 'failed',
        contentHash,
        diff: built.value.diff,
        fileManifest: {},
        log: message,
        summary: 'Publish fehlgeschlagen',
      });
      return conflict('publishFailed', message.slice(0, 2000));
    }
    const record = await step(h, 'record', limitFor(env, 'record'), async () =>
      recordPublish(deps, ctx, {
        environment: deps.env,
        startedAt,
        status: 'success',
        contentHash,
        diff: built.value.diff,
        fileManifest: built.value.manifest,
        contentManifest: contentManifestOf(built.value.exported.items),
        log: built.value.log + transferLog,
        summary: `Publiziert: ${built.value.diff.changed.length} geändert, ${built.value.diff.added.length} neu, ${built.value.diff.removed.length} entfernt`,
      }),
    );
    return ok({ status: 'success' as const, record, diff: built.value.diff, log: transferLog, skippedImages: built.value.skippedImages });
  } catch (error) {
    if (error instanceof JobAbortedError) {
      // Ein Zeitlimit mitten in der Übertragung ist ein gescheiterter Publish, kein sauberer Abbruch.
      recordPublish(deps, ctx, {
        environment: deps.env,
        startedAt,
        status: error.step === 'transfer' || error.step === 'record' ? 'failed' : 'aborted',
        contentHash,
        diff: { changed: [], added: [], removed: [] },
        fileManifest: {},
        log: `${error.reason} (${error.step ?? '–'})`,
        summary: `Publish abgebrochen: ${error.reason} (${error.step ?? '–'})`,
      });
    }
    throw error;
  } finally {
    await removeQuietly(outDir);
  }
}
