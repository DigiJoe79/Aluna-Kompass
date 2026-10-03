import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isoNow, localizedConflict, newId, type Clock } from '@kompass/core';
import type { SiteEnv } from './env';
import { JobAbortedError } from './step';

export const SITE_JOB_KINDS = ['preview', 'publish', 'deployCheck'] as const;
export type SiteJobKind = (typeof SITE_JOB_KINDS)[number];
export type StepKey = 'export' | 'images' | 'build' | 'copyImages' | 'checksums' | 'connect' | 'targetDir' | 'writable' | 'targetFiles' | 'transfer' | 'record';
export type StepState = 'pending' | 'running' | 'done' | 'skipped';

export interface SiteJobStep {
  key: StepKey;
  state: StepState;
  done?: number;
  total?: number;
  detail?: { generated?: number };
  startedAt?: string;
}

export interface SiteJobRun {
  /** Kennung dieses Laufs — der Start nennt sie, das Ergebnis trägt sie. */
  runId: string;
  kind: SiteJobKind;
  source: 'ui' | 'mcp';
  userId: string;
  /** Der API-Token, mit dem ein MCP-Lauf gestartet wurde; für die Marke „MCP · Tokenname“. */
  apiTokenId?: string | null;
  startedAt: string;
  steps: SiteJobStep[];
  cancellable: boolean;
}

export interface RunHandle {
  run: SiteJobRun;
  signal: AbortSignal;
  begin(step: StepKey): void;
  progress(step: StepKey, done: number, total?: number, detail?: SiteJobStep['detail']): void;
  skip(step: StepKey): void;
  finish(step: StepKey): void;
  setCancellable(v: boolean): void;
}

const CORE: StepKey[] = ['export', 'images', 'build', 'copyImages', 'checksums'];
export const STEPS: Record<SiteJobKind, StepKey[]> = {
  preview: CORE,
  // Vier Prüfpunkte nur mit rsync: kein Export, kein Bau.
  deployCheck: ['connect', 'targetDir', 'writable', 'targetFiles'],
  publish: [...CORE, 'transfer', 'record'],
};

/**
 * Der Lauf liegt im Speicher (auf `globalThis`, das sich alle Route-Bündel
 * eines Prozesses teilen) und wird atomar nach `running-job.json` gespiegelt.
 * Die Datei trägt eine Kennung des Prozesses: Eine Datei aus einem neu
 * gestarteten oder abgestürzten Prozess gilt nicht als laufender Job.
 */
interface Active {
  run: SiteJobRun;
  controller: AbortController;
  env: SiteEnv;
  clock: Clock;
  lastWrite: number;
}

const runs = (): Map<string, Active> => ((globalThis as { __kompassSiteRuns?: Map<string, Active> }).__kompassSiteRuns ??= new Map());
const lockFile = (env: SiteEnv) => path.join(env.cacheDir, 'running-job.json');
export const resultFile = (env: SiteEnv, kind: SiteJobKind) => path.join(env.cacheDir, `${kind}-result.json`);

export function siteProcessToken(): string {
  const holder = globalThis as unknown as { __kompassSiteProcess?: string };
  return (holder.__kompassSiteProcess ??= newId());
}

export function writeJsonAtomic(file: string, value: unknown): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, file);
}

const mirror = (a: Active, force = false) => {
  const now = performance.now();
  if (!force && now - a.lastWrite < 2_000) return; // Fortschritt gedrosselt, Schrittwechsel immer
  a.lastWrite = now;
  writeJsonAtomic(lockFile(a.env), { ...a.run, process: siteProcessToken(), updatedAt: isoNow(a.clock) });
};

/** Laufverzeichnisse tragen dieses Präfix; nur sie räumt ein Neustart ab (andere `kompass-site-*` gehören parallelen Prüfungen). */
export const SITE_JOB_TMP_PREFIX = 'kompass-sitejob-';
export const workRoot = (env: SiteEnv): string => env.workDir ?? tmpdir();

/**
 * Der Speicher ist die Quelle: Eine Riegeldatei ohne Lauf im Speicher — aus
 * einem neu gestarteten Prozess, auch mit derselben Prozessnummer, oder aus
 * 0.2.4 — war ein unterbrochener Lauf. Er bekommt ein Ergebnis, der Riegel
 * und die Laufverzeichnisse werden geräumt.
 */
function settleForeignLock(env: SiteEnv): void {
  let lock: (Partial<SiteJobRun> & { name?: SiteJobKind; updatedAt?: string }) | undefined;
  try {
    lock = JSON.parse(readFileSync(lockFile(env), 'utf8'));
  } catch {
    return;
  }
  const kind = lock?.kind ?? lock?.name;
  if (lock && kind && lock.runId && lock.startedAt) {
    const steps = lock.steps ?? [];
    const lastStep = steps.find((s) => s.state === 'running')?.key;
    const failed = localizedConflict('jobInterrupted', 'site.publish.job.errors.jobInterrupted');
    writeJsonAtomic(resultFile(env, kind), {
      kind,
      runId: lock.runId,
      startedAt: lock.startedAt,
      finishedAt: lock.updatedAt ?? lock.startedAt,
      userId: lock.userId || null,
      status: 'interrupted',
      steps,
      ...(lastStep ? { lastStep } : {}),
      error: failed.ok ? undefined : failed.error,
      historyPending: kind === 'publish',
    });
  }
  rmSync(lockFile(env), { force: true });
  let names: string[] = [];
  try {
    names = readdirSync(workRoot(env));
  } catch {
    // keine Wurzel, nichts zu räumen
  }
  for (const n of names) {
    if (n.startsWith(SITE_JOB_TMP_PREFIX)) rmSync(path.join(workRoot(env), n), { recursive: true, force: true, maxRetries: 3 });
  }
}

export function runningSiteJob(env: SiteEnv): SiteJobRun | null {
  const active = runs().get(env.cacheDir);
  if (active) return structuredClone(active.run);
  settleForeignLock(env);
  return null;
}

export function beginRun(
  env: SiteEnv,
  clock: Clock,
  init: { kind: SiteJobKind; source: 'ui' | 'mcp'; userId: string; apiTokenId?: string | null; runId: string },
): RunHandle | { busy: SiteJobRun } {
  // Prüfen und Schreiben ohne await dazwischen, sonst kämen zwei Aufrufe
  // gleichzeitig an der Prüfung vorbei.
  const busy = runningSiteJob(env);
  if (busy) return { busy };
  const run: SiteJobRun = {
    ...init,
    startedAt: isoNow(clock),
    cancellable: true,
    steps: STEPS[init.kind].map((key) => ({ key, state: 'pending' as const })),
  };
  const a: Active = { run, controller: new AbortController(), env, clock, lastWrite: 0 };
  mkdirSync(env.cacheDir, { recursive: true });
  runs().set(env.cacheDir, a);
  mirror(a, true);
  const at = (key: StepKey) => run.steps.find((s) => s.key === key)!;
  return {
    run,
    signal: a.controller.signal,
    begin: (key) => {
      Object.assign(at(key), { state: 'running', startedAt: isoNow(clock) });
      mirror(a, true);
    },
    progress: (key, done, total, detail) => {
      Object.assign(at(key), { done, ...(total === undefined ? {} : { total }), ...(detail ? { detail } : {}) });
      mirror(a);
    },
    skip: (key) => {
      at(key).state = 'skipped';
      mirror(a, true);
    },
    finish: (key) => {
      at(key).state = 'done';
      mirror(a, true);
    },
    setCancellable: (v) => {
      run.cancellable = v;
      mirror(a, true);
    },
  };
}

export function endRun(env: SiteEnv, runId: string): void {
  const a = runs().get(env.cacheDir);
  if (a?.run.runId === runId) runs().delete(env.cacheDir);
  rmSync(lockFile(env), { force: true });
}

export function requestCancel(runId: string): boolean {
  const a = [...runs().values()].find((r) => r.run.runId === runId);
  if (!a || !a.run.cancellable) return false;
  const running = a.run.steps.find((s) => s.state === 'running')?.key ?? null;
  a.controller.abort(new JobAbortedError('cancelled', running));
  return true;
}
