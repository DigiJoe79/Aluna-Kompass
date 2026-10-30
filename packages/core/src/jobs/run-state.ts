import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isoNow, type Clock } from '../clock';
import { newId } from '../ids';
import { localizedConflict, type ServiceError } from '../result';
import { JobAbortedError } from './step';

/*
 * Lauf-Mechanik für Hintergrundläufe im Kern. Vorbild ist die Webseite (`packages/modules/site/src/pipeline/`
 * `run-state.ts`, `step.ts`, `jobs.ts`); sie zieht vorerst nicht hierher um (Spec Backup § Nicht Teil davon).
 *
 * Ein Platz (`JobSlot`) nimmt genau einen Lauf zugleich. Der Lauf liegt im Speicher (auf `globalThis`, das sich alle
 * Route-Bündel eines Prozesses teilen) und wird atomar nach `running-job.json` gespiegelt. Die Datei trägt eine
 * Kennung des Prozesses: Eine Datei ohne Lauf im Speicher stammt aus einem neu gestarteten oder abgestürzten Prozess
 * und wird zum Ergebnis `interrupted`.
 */

export type JobSource = 'ui' | 'mcp' | 'system';
export type JobStepState = 'pending' | 'running' | 'done' | 'skipped';

export interface JobStep {
  key: string;
  state: JobStepState;
  done?: number;
  total?: number;
  startedAt?: string;
}

export type JobMeta = Record<string, string | number | boolean | null>;

export interface JobRun {
  /** Kennung dieses Laufs — der Start nennt sie, das Ergebnis trägt sie. */
  runId: string;
  kind: string;
  source: JobSource;
  userId: string | null;
  apiTokenId?: string | null;
  startedAt: string;
  steps: JobStep[];
  cancellable: boolean;
  meta: JobMeta;
}

/** Der letzte abgeschlossene Lauf einer Art, als Datei je Art neben dem Riegel. */
export interface JobRecord<T = unknown> {
  kind: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  userId: string | null;
  status: 'success' | 'failed' | 'aborted' | 'interrupted';
  reason?: 'cancelled' | 'timeout';
  /** Bei `reason: 'timeout'`: die gerissene Grenze. */
  timeout?: { limitMs: number; stalled: boolean };
  lastStep?: string;
  /** Endstand der Schritte. */
  steps: JobStep[];
  meta: JobMeta;
  result?: T;
  error?: ServiceError;
}

/** Wo ein Lauf seinen Riegel und seine Ergebnisse ablegt, und welche Arbeitsdateien ein Neustart abräumt. */
export interface JobSlot {
  /** Schlüssel im Speicher; je Platz ein Lauf. */
  key: string;
  /** Riegel `running-job.json` und Ergebnisse `<kind>-result.json`. */
  dir: string;
  /** Hier liegen Arbeitsdateien des Laufs … */
  workDir: string;
  /** … mit diesem Präfix; nur sie räumt ein Neustart ab. */
  tmpPrefix: string;
}

export interface JobHandle {
  run: JobRun;
  signal: AbortSignal;
  begin(step: string): void;
  progress(step: string, done: number, total?: number): void;
  skip(step: string): void;
  finish(step: string): void;
  setCancellable(v: boolean): void;
  setMeta(patch: JobMeta): void;
}

export type JobStart = { started: true; runId: string; startedAt: string } | { started: false; running: JobRun };

interface Active {
  run: JobRun;
  controller: AbortController;
  slot: JobSlot;
  clock: Clock;
  lastWrite: number;
  /** Löst mit dem Ergebnis auf, sobald der Lauf endet (`null`, wenn er ohne Ergebnis endet). */
  settled: Promise<JobRecord | null>;
  settle(record: JobRecord | null): void;
}

const runs = (): Map<string, Active> => ((globalThis as { __kompassJobs?: Map<string, Active> }).__kompassJobs ??= new Map());
const lockFile = (slot: JobSlot) => path.join(slot.dir, 'running-job.json');
export const jobResultFile = (slot: JobSlot, kind: string) => path.join(slot.dir, `${kind}-result.json`);

function processToken(): string {
  const holder = globalThis as unknown as { __kompassJobProcess?: string };
  return (holder.__kompassJobProcess ??= newId());
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
  writeJsonAtomic(lockFile(a.slot), { ...a.run, process: processToken(), updatedAt: isoNow(a.clock) });
};

/** Das Ergebnis eines Laufs dieser Art; fehlt oder ist unlesbar → `null`. */
export function readJobResult<T = unknown>(slot: JobSlot, kind: string): JobRecord<T> | null {
  try {
    return JSON.parse(readFileSync(jobResultFile(slot, kind), 'utf8')) as JobRecord<T>;
  } catch {
    return null;
  }
}

/** Nur für `launch.ts`: schreibt das Ergebnis und weckt die Wartenden. */
export function saveJobResult(slot: JobSlot, record: JobRecord): void {
  mkdirSync(slot.dir, { recursive: true });
  writeJsonAtomic(jobResultFile(slot, record.kind), record);
  const a = runs().get(slot.key);
  if (a?.run.runId === record.runId) a.settle(record);
}

/**
 * Der Speicher ist die Quelle: Eine Riegeldatei ohne Lauf im Speicher — aus einem neu gestarteten Prozess, auch mit
 * derselben Prozessnummer — war ein unterbrochener Lauf. Er bekommt ein Ergebnis, Riegel und Arbeitsdateien werden
 * geräumt.
 */
function settleForeignLock(slot: JobSlot): void {
  let lock: (Partial<JobRun> & { updatedAt?: string }) | undefined;
  try {
    lock = JSON.parse(readFileSync(lockFile(slot), 'utf8'));
  } catch {
    return;
  }
  const kind = lock?.kind;
  if (lock && kind && lock.runId && lock.startedAt) {
    const steps = lock.steps ?? [];
    const lastStep = steps.find((s) => s.state === 'running')?.key;
    const failed = localizedConflict('jobInterrupted', 'jobs.errors.jobInterrupted');
    writeJsonAtomic(jobResultFile(slot, kind), {
      kind,
      runId: lock.runId,
      startedAt: lock.startedAt,
      finishedAt: lock.updatedAt ?? lock.startedAt,
      userId: lock.userId || null,
      status: 'interrupted',
      steps,
      meta: lock.meta ?? {},
      ...(lastStep ? { lastStep } : {}),
      error: failed.error,
    } satisfies JobRecord);
    console.log(`[jobs:${kind}] unterbrochen im Schritt ${lastStep ?? '–'}`);
  }
  rmSync(lockFile(slot), { force: true });
  let names: string[] = [];
  try {
    names = readdirSync(slot.workDir);
  } catch {
    // kein Arbeitsverzeichnis, nichts zu räumen
  }
  for (const n of names) {
    if (n.startsWith(slot.tmpPrefix)) rmSync(path.join(slot.workDir, n), { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * Die Schlüssel aller Läufe, die in diesem Prozess gerade arbeiten — gleich welcher Art. Das Einspielen eines Backups
 * fragt hier, ob es einem Lauf (Datenexport, Prüfpaket …) die Datenbank unter den Händen wegzöge.
 */
export function activeJobSlotKeys(): string[] {
  return [...runs().keys()];
}

export function runningJob(slot: JobSlot): JobRun | null {
  const active = runs().get(slot.key);
  if (active) return structuredClone(active.run);
  settleForeignLock(slot);
  return null;
}

/** Nur für `launch.ts`: worauf `waitForJob` wartet. */
export function activeSettled(slot: JobSlot, runId: string): Promise<JobRecord | null> | null {
  const a = runs().get(slot.key);
  return a?.run.runId === runId ? a.settled : null;
}

export function beginJob(
  slot: JobSlot,
  clock: Clock,
  init: { kind: string; steps: readonly string[]; source: JobSource; userId: string | null; apiTokenId?: string | null; runId: string; meta?: JobMeta },
): JobHandle | { busy: JobRun } {
  // Prüfen und Schreiben ohne await dazwischen, sonst kämen zwei Aufrufe gleichzeitig an der Prüfung vorbei.
  const busy = runningJob(slot);
  if (busy) return { busy };
  const run: JobRun = {
    runId: init.runId,
    kind: init.kind,
    source: init.source,
    userId: init.userId,
    ...(init.apiTokenId === undefined ? {} : { apiTokenId: init.apiTokenId }),
    startedAt: isoNow(clock),
    cancellable: true,
    steps: init.steps.map((key) => ({ key, state: 'pending' as const })),
    meta: { ...(init.meta ?? {}) },
  };
  let settle!: (record: JobRecord | null) => void;
  const settled = new Promise<JobRecord | null>((resolve) => (settle = resolve));
  const a: Active = { run, controller: new AbortController(), slot, clock, lastWrite: 0, settled, settle };
  mkdirSync(slot.dir, { recursive: true });
  runs().set(slot.key, a);
  mirror(a, true);
  const at = (key: string) => {
    const found = run.steps.find((s) => s.key === key);
    if (!found) throw new Error(`unknown step ${key} in job ${run.kind}`);
    return found;
  };
  return {
    run,
    signal: a.controller.signal,
    begin: (key) => {
      Object.assign(at(key), { state: 'running', startedAt: isoNow(clock) });
      mirror(a, true);
    },
    progress: (key, done, total) => {
      Object.assign(at(key), { done, ...(total === undefined ? {} : { total }) });
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
    setMeta: (patch) => {
      Object.assign(run.meta, patch);
      mirror(a, true);
    },
  };
}

export function endJob(slot: JobSlot, runId: string): void {
  const a = runs().get(slot.key);
  if (a?.run.runId !== runId) return;
  runs().delete(slot.key);
  rmSync(lockFile(slot), { force: true });
  a.settle(null);
}

export function requestJobCancel(slot: JobSlot, runId: string): boolean {
  const a = runs().get(slot.key);
  if (!a || a.run.runId !== runId || !a.run.cancellable) return false;
  const running = a.run.steps.find((s) => s.state === 'running')?.key ?? null;
  a.controller.abort(new JobAbortedError('cancelled', running));
  return true;
}
