import { readdirSync } from 'node:fs';
import { isoNow, type Clock } from '../clock';
import { conflict, localizedConflict, type Failure, type Result } from '../result';
import { activeSettled, beginJob, endJob, readJobResult, saveJobResult, type JobHandle, type JobRecord, type JobRun, type JobSlot } from './run-state';
import { JobAbortedError } from './step';

const abortedConflict = (e: JobAbortedError) =>
  e.reason === 'cancelled' ? localizedConflict('jobCancelled', 'jobs.errors.jobCancelled', { step: e.step ?? '' }) : localizedConflict('stepTimedOut', 'jobs.errors.stepTimedOut', { step: e.step ?? '' });

/** Ein anderer Lauf belegt den Platz: Satz und Ausweg aus `jobs.errors.jobRunning`. */
export function jobRunningConflict(run: JobRun): Failure {
  return localizedConflict('jobRunning', 'jobs.errors.jobRunning', { kind: run.kind });
}

/**
 * Ein Lauf unter dem Riegel, dessen Ausgang — Ergebnis, Fachfehler, Abbruch oder technischer Fehler — als letzter Lauf
 * seiner Art im Platz landet. Nimmt den Riegel **ohne await davor**, damit ein Start ihn synchron hält, bevor er
 * antwortet. `done` verwirft nur bei einem technischen Fehler.
 */
export function launchJob<T>(
  slot: JobSlot,
  clock: Clock,
  init: Parameters<typeof beginJob>[2],
  body: (h: JobHandle) => Promise<Result<T>>,
): { busy: JobRun } | { run: JobRun; done: Promise<Result<T>> } {
  const begun = beginJob(slot, clock, init);
  if ('busy' in begun) return begun;
  const h = begun;
  let stoppedAt: string | undefined;
  const save = (outcome: Pick<JobRecord<T>, 'status' | 'result' | 'error' | 'reason' | 'timeout'>) => {
    const lastStep = outcome.status === 'success' ? undefined : (h.run.steps.find((s) => s.state === 'running')?.key ?? stoppedAt);
    saveJobResult(slot, {
      kind: h.run.kind,
      runId: h.run.runId,
      startedAt: h.run.startedAt,
      finishedAt: isoNow(clock),
      userId: h.run.userId,
      steps: h.run.steps,
      meta: h.run.meta,
      ...(lastStep ? { lastStep } : {}),
      ...outcome,
    });
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
        save({ status: 'aborted', reason: error.reason, ...(error.limit ? { timeout: { limitMs: error.limit.ms, stalled: error.limit.stalled } } : {}), error: stopped.error });
        return stopped as Result<T>;
      }
      const failed = conflict(`${h.run.kind}Failed`, (error instanceof Error ? error.message : String(error)).slice(0, 2000));
      console.error(`[jobs:${h.run.kind}] fehlgeschlagen`, error);
      save({ status: 'failed', error: failed.error });
      throw error;
    } finally {
      endJob(slot, h.run.runId);
    }
  })();
  return { run: h.run, done };
}

/**
 * Wartet auf das Ende eines Laufs und liefert sein Ergebnis. Ist er schon vorbei, kommt das Ergebnis aus der Datei;
 * kennt der Platz die Kennung nicht (oder liegt schon ein neuerer Lauf derselben Art), `null`.
 */
export async function waitForJob(slot: JobSlot, runId: string): Promise<JobRecord | null> {
  const pending = activeSettled(slot, runId);
  if (pending) {
    const record = await pending;
    if (record) return record;
  }
  let names: string[] = [];
  try {
    names = readdirSync(slot.dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('-result.json')) continue;
    const record = readJobResult(slot, name.slice(0, -'-result.json'.length));
    if (record?.runId === runId) return record;
  }
  return null;
}
