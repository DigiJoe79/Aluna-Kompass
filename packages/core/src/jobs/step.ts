import type { JobHandle } from './run-state';

/** Der Lauf endet vorzeitig: auf Wunsch oder weil ein Schritt sein Zeitlimit riss. */
export class JobAbortedError extends Error {
  constructor(
    readonly reason: 'cancelled' | 'timeout',
    readonly step: string | null,
    /** Bei einem Zeitlimit: welche Grenze riss — die Gesamtdauer oder der Stillstand des Zählers. */
    readonly limit?: { ms: number; stalled: boolean },
  ) {
    super(`job ${reason}${step ? ` in step ${step}` : ''}`);
    this.name = 'JobAbortedError';
  }
}

export interface StepLimit {
  totalMs: number;
  stallMs: number;
}

export interface StepControl {
  signal: AbortSignal;
  progress(done: number, total?: number): void;
  setLimit(limit: StepLimit): void;
}

/**
 * Führt einen Schritt des Laufs aus: setzt ihn auf „läuft“, gibt der Arbeit ein Signal (Abbruch oder Zeitlimit),
 * wacht über Gesamtdauer und Stillstand des Zählers und schreibt jeden Schritt mit Dauer nach stdout.
 *
 * Wartet auf das **echte Ende** der Arbeit — kein `Promise.race`. Sonst liefe sie nach dem Zeitlimit weiter und
 * hielte Dateien, die das Aufräumen gleichzeitig löscht.
 */
export async function runStep<T>(h: JobHandle, key: string, limit: StepLimit, work: (c: StepControl) => Promise<T>): Promise<T> {
  h.signal.throwIfAborted();
  h.begin(key);
  const local = new AbortController();
  const signal = AbortSignal.any([h.signal, local.signal]);
  const started = performance.now();
  let moved = started;
  let current = limit;
  const expire = (stalled: boolean) => local.abort(new JobAbortedError('timeout', key, { ms: stalled ? current.stallMs : current.totalMs, stalled }));
  let total = setTimeout(() => expire(false), current.totalMs);
  const watch = setInterval(() => {
    if (performance.now() - moved > current.stallMs) expire(true);
  }, Math.max(10, Math.min(1_000, limit.stallMs)));
  const control: StepControl = {
    signal,
    progress: (done, all) => {
      moved = performance.now();
      h.progress(key, done, all);
    },
    setLimit: (next) => {
      current = next;
      clearTimeout(total);
      total = setTimeout(() => expire(false), Math.max(0, next.totalMs - (performance.now() - started)));
    },
  };
  const tag = `[jobs:${h.run.kind}]`;
  console.log(`${tag} ${key} …`);
  try {
    const value = await work(control);
    signal.throwIfAborted();
    h.finish(key);
    console.log(`${tag} ${key} fertig nach ${Math.round(performance.now() - started)} ms`);
    return value;
  } catch (error) {
    if (!signal.aborted) throw error;
    const reason = signal.reason instanceof JobAbortedError ? signal.reason : new JobAbortedError('cancelled', key);
    console.log(`${tag} ${key} ${reason.reason === 'timeout' ? 'Zeitlimit' : 'abgebrochen'} nach ${Math.round(performance.now() - started)} ms`);
    throw reason.step ? reason : new JobAbortedError(reason.reason, key, reason.limit);
  } finally {
    clearTimeout(total);
    clearInterval(watch);
  }
}
