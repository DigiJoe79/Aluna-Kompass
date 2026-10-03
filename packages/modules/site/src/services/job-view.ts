import { apiTokenNamesFor, ok, requirePermission, userNamesFor, validate, type CallContext, type Deps, type Result, type ServiceError } from '@kompass/core';
import { z } from 'zod';
import type { SiteContentExport } from '../export';
import { classifyDeployError, type DeployProblem } from '../pipeline/deploy-errors';
import type { DeployCheckItem } from '../pipeline/deploy-check';
import type { SiteEnv } from '../pipeline/env';
import { lastSiteJob, settleInterruptedPublish, siteJobElapsedMs, type DeployCheckResult, type PreviewResult, type PublishResult, type SiteJobRecord } from '../pipeline/jobs';
import { runningSiteJob, SITE_JOB_KINDS, type SiteJobKind, type SiteJobRun, type StepKey } from '../pipeline/run-state';
import { lastSuccessfulPublish } from './publishes';

const LIMIT = 20;
/** Gemessen (mcp-size.test.ts): Mit 20 Einträgen je Prüfliste überschritt die Vorschau 10.000 Zeichen; 10 reichen für den Überblick. */
const CHECK_LIMIT = 10;
const LOG_TAIL = 2000;

export interface PathList<T = string> {
  items: T[];
  total: number;
  truncated: boolean;
}

export const trimPaths = <T>(list: readonly T[] | undefined, limit = LIMIT): PathList<T> => {
  const all = list ?? [];
  return { items: all.slice(0, limit), total: all.length, truncated: all.length > limit };
};

export const tailLog = (log: string | undefined, max = LOG_TAIL): { text: string; truncated: boolean } => {
  const text = log ?? '';
  return text.length > max ? { text: text.slice(-max), truncated: true } : { text, truncated: false };
};

export type SiteJobStatus = 'success' | 'failed' | 'aborted' | 'interrupted';

export interface SiteJobCounts {
  changed: number;
  added: number;
  removed: number;
  violations: number;
  gaps: number;
  stale: number;
  pendingReview: number;
  skippedImages: number;
  filesAtTarget?: number;
}

export interface SiteJobSummary {
  kind: SiteJobKind;
  runId: string;
  startedAt: string;
  finishedAt: string;
  userId: string | null;
  userName: string | null;
  status: SiteJobStatus;
  reason?: 'cancelled' | 'timeout';
  lastStep?: StepKey;
  error?: ServiceError;
  counts: SiteJobCounts;
  contentHash?: string;
  publishId?: string;
  /** Nur deployCheck: Alle Prüfpunkte bestanden. Fehlt bei Ergebnissen aus 0.2.5-dev ohne Prüfpunkte. */
  passed?: boolean;
  /** Bei `reason: 'timeout'`: die gerissene Grenze (`stalled`: der Zähler stand still, sonst die Gesamtdauer). */
  timeout?: { limitMs: number; stalled: boolean };
  /** Zählerstand des Schritts, bei dem der Lauf endete. */
  stoppedAt?: { done?: number; total?: number };
  /** Nur publish, nicht erfolgreich: Grund in Worten der Oberfläche. */
  failure?: DeployProblem | 'build' | 'previewOutdated' | 'blockedTerms';
  /** Nur preview: Danach lief ein erfolgreicher Publish, also gibt sie nichts mehr frei. */
  superseded?: boolean;
}

export interface SiteJobDetail extends SiteJobSummary {
  diff?: { changed: PathList; added: PathList; removed: PathList };
  violations?: SiteContentExport['violations'];
  gaps?: PathList<SiteContentExport['gaps'][number]>;
  stale?: PathList<SiteContentExport['stale'][number]>;
  pendingReview?: PathList<SiteContentExport['pendingReview'][number]>;
  /** Dateinamen der Bilder, die sich nicht lesen ließen. */
  skippedImages?: PathList;
  filesAtTarget?: PathList;
  checks?: DeployCheckItem[];
  target?: string;
  log: { text: string; truncated: boolean };
}

export type SiteJobRunView = SiteJobRun & { elapsedMs: number; userName: string | null; tokenName: string | null };

type Parts = Partial<PreviewResult & DeployCheckResult & PublishResult>;

/** Die Ergebnisformen der drei Arten auf einen Nenner; alte Dateien (0.2.4) ohne Felder zählen 0. */
function parts(record: SiteJobRecord) {
  const r = (record.result ?? {}) as Parts;
  return { r, diff: r.diff };
}

const FAILURE_BY_CODE: Record<string, SiteJobSummary['failure']> = {
  deployCredentialsUnusable: 'authFailed',
  siteBuildFailed: 'build',
  previewOutdated: 'previewOutdated',
  blockedTermsPresent: 'blockedTerms',
};

function failureOf(record: SiteJobRecord): SiteJobSummary['failure'] | undefined {
  if (record.kind !== 'publish' || record.status === 'success' || !record.error) return undefined;
  if (record.error.type !== 'conflict') return undefined;
  if (record.error.code === 'publishFailed') return classifyDeployError(record.error.message, 'transfer');
  return FAILURE_BY_CODE[record.error.code];
}

function summarize(record: SiteJobRecord, names: Map<string, string>, lastPublishStart: string | null): SiteJobSummary {
  const { r, diff } = parts(record);
  const contentHash = r.contentHash ?? r.record?.contentHash;
  return {
    kind: record.kind,
    runId: record.runId,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    userId: record.userId ?? null,
    userName: record.userId ? (names.get(record.userId) ?? null) : null,
    status: record.status ?? (record.error ? 'failed' : 'success'),
    ...(record.reason ? { reason: record.reason } : {}),
    ...(record.lastStep ? { lastStep: record.lastStep } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(record.timeout ? { timeout: record.timeout } : {}),
    ...(() => {
      const stopped = record.lastStep ? record.steps?.find((st) => st.key === record.lastStep) : undefined;
      return stopped && (stopped.done !== undefined || stopped.total !== undefined)
        ? { stoppedAt: { ...(stopped.done !== undefined ? { done: stopped.done } : {}), ...(stopped.total !== undefined ? { total: stopped.total } : {}) } }
        : {};
    })(),
    ...(record.kind === 'deployCheck' && typeof r.passed === 'boolean' ? { passed: r.passed } : {}),
    ...(failureOf(record) ? { failure: failureOf(record) } : {}),
    counts: {
      changed: diff?.changed?.length ?? 0,
      added: diff?.added?.length ?? 0,
      removed: diff?.removed?.length ?? 0,
      violations: r.violations?.length ?? 0,
      gaps: r.gaps?.length ?? 0,
      stale: r.stale?.length ?? 0,
      pendingReview: r.pendingReview?.length ?? 0,
      skippedImages: r.skippedImages?.length ?? 0,
      ...(r.filesAtTarget ? { filesAtTarget: r.filesAtTarget.length } : {}),
    },
    ...(contentHash ? { contentHash } : {}),
    ...(r.record?.id ? { publishId: r.record.id } : {}),
    ...(record.kind === 'preview' ? { superseded: lastPublishStart !== null && lastPublishStart > record.finishedAt } : {}),
  };
}

function detail(record: SiteJobRecord, names: Map<string, string>, lastPublishStart: string | null, opts: { paths?: 'all'; log?: 'full' }): SiteJobDetail {
  const { r, diff } = parts(record);
  const limit = opts.paths === 'all' ? Infinity : LIMIT;
  return {
    ...summarize(record, names, lastPublishStart),
    ...(diff ? { diff: { changed: trimPaths(diff.changed, limit), added: trimPaths(diff.added, limit), removed: trimPaths(diff.removed, limit) } } : {}),
    ...(r.violations ? { violations: r.violations } : {}),
    ...(r.gaps ? { gaps: trimPaths(r.gaps, opts.paths === 'all' ? Infinity : CHECK_LIMIT) } : {}),
    ...(r.stale ? { stale: trimPaths(r.stale, opts.paths === 'all' ? Infinity : CHECK_LIMIT) } : {}),
    ...(r.pendingReview ? { pendingReview: trimPaths(r.pendingReview, opts.paths === 'all' ? Infinity : CHECK_LIMIT) } : {}),
    ...(r.skippedImages?.length ? { skippedImages: trimPaths(r.skippedImages.map((s) => s.filename), limit) } : {}),
    ...(r.filesAtTarget ? { filesAtTarget: trimPaths(r.filesAtTarget, limit) } : {}),
    ...(r.checks ? { checks: r.checks } : {}),
    ...(r.target ? { target: r.target } : {}),
    log: tailLog(r.log ?? r.record?.log, opts.log === 'full' ? Infinity : LOG_TAIL),
  };
}

const runView = (deps: Deps, run: SiteJobRun | null, names: Map<string, string>): SiteJobRunView | null =>
  run
    ? { ...run, elapsedMs: siteJobElapsedMs(run, deps.clock), userName: names.get(run.userId) ?? null, tokenName: run.apiTokenId ? (apiTokenNamesFor(deps, [run.apiTokenId]).get(run.apiTokenId) ?? null) : null }
    : null;

const inputSchema = z.object({ kind: z.enum(SITE_JOB_KINDS), paths: z.literal('all').optional(), log: z.literal('full').optional() });

/** Laufzustand und die letzten Ergebnisse aller drei Arten, in Kurzform: Takt der Oberfläche. */
export function siteJobOverview(deps: Deps, ctx: CallContext, env: SiteEnv): Result<{ running: SiteJobRunView | null; last: Record<SiteJobKind, SiteJobSummary | null> }> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  settleInterruptedPublish(deps, env);
  const running = runningSiteJob(env);
  const records = {} as Record<SiteJobKind, SiteJobRecord | null>;
  for (const kind of SITE_JOB_KINDS) {
    const read = lastSiteJob(deps, ctx, env, { kind });
    if (!read.ok) return read;
    records[kind] = read.value.last;
  }
  const names = userNamesFor(deps, [running?.userId, ...SITE_JOB_KINDS.map((k) => records[k]?.userId)]);
  const lastPublishStart = lastSuccessfulPublish(deps, deps.env)?.startedAt ?? null;
  const last = Object.fromEntries(SITE_JOB_KINDS.map((k) => [k, records[k] ? summarize(records[k], names, lastPublishStart) : null])) as Record<SiteJobKind, SiteJobSummary | null>;
  return ok({ running: runView(deps, running, names), last });
}

/** Ein Lauf im Einzelnen; Listen auf 20 gekürzt, das Protokoll auf sein Ende, wenn nicht anders verlangt. */
export function siteJobResult(deps: Deps, ctx: CallContext, env: SiteEnv, input: unknown): Result<{ running: SiteJobRunView | null; last: SiteJobDetail | null }> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  const parsed = validate(deps, inputSchema, input);
  if (!parsed.ok) return parsed;
  const read = lastSiteJob(deps, ctx, env, { kind: parsed.value.kind });
  if (!read.ok) return read;
  const { running, last } = read.value;
  const names = userNamesFor(deps, [running?.userId, last?.userId]);
  const lastPublishStart = lastSuccessfulPublish(deps, deps.env)?.startedAt ?? null;
  return ok({ running: runView(deps, running, names), last: last ? detail(last, names, lastPublishStart, parsed.value) : null });
}
