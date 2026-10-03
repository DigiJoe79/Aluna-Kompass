import { rm } from 'node:fs/promises';
import type { RunHandle, SiteJobStep, StepKey } from './run-state';

/** Der Lauf endet vorzeitig: auf Wunsch oder weil ein Schritt sein Zeitlimit riss. */
export class JobAbortedError extends Error {
  constructor(
    readonly reason: 'cancelled' | 'timeout',
    readonly step: StepKey | null,
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
  perItemMs?: number;
}

export interface StepControl {
  signal: AbortSignal;
  progress(done: number, total?: number, detail?: SiteJobStep['detail']): void;
  setLimit(limit: StepLimit): void;
}

/**
 * Führt einen Schritt des Laufs aus: setzt ihn auf „läuft“, gibt der Arbeit
 * ein Signal (Abbruch oder Zeitlimit), wacht über Gesamtdauer und Stillstand
 * des Zählers und schreibt jeden Schritt mit Dauer nach stdout.
 *
 * Wartet auf das **echte Ende** der Arbeit — kein `Promise.race`. Sonst liefe
 * sie nach dem Zeitlimit weiter, belegte einen Worker und hielte Dateien, die
 * das Aufräumen gleichzeitig löscht (ENOTEMPTY).
 */
export async function step<T>(h: RunHandle, key: StepKey, limit: StepLimit, work: (c: StepControl) => Promise<T>, opts: { endAs?: 'done' | 'skipped'; startAs?: 'skipped' } = {}): Promise<T> {
  h.signal.throwIfAborted();
  // `startAs: 'skipped'`: Der Schritt entfällt, aber seine Arbeit (das Übernehmen der Vorschau) läuft unter Zeitlimit und Abbruch weiter und zählt mit.
  if (opts.startAs === 'skipped') h.skip(key);
  else h.begin(key);
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
    progress: (done, all, detail) => {
      moved = performance.now();
      h.progress(key, done, all, detail);
    },
    setLimit: (next) => {
      current = next;
      clearTimeout(total);
      total = setTimeout(() => expire(false), Math.max(0, next.totalMs - (performance.now() - started)));
    },
  };
  console.log(`[site] ${key} …`);
  try {
    const value = await work(control);
    signal.throwIfAborted();
    if (opts.endAs === 'skipped') h.skip(key);
    else if (opts.startAs !== 'skipped') h.finish(key);
    console.log(`[site] ${key} fertig nach ${Math.round(performance.now() - started)} ms`);
    return value;
  } catch (error) {
    if (!signal.aborted) throw error;
    const reason = signal.reason instanceof JobAbortedError ? signal.reason : new JobAbortedError('cancelled', key);
    console.log(`[site] ${key} ${reason.reason === 'timeout' ? 'Zeitlimit' : 'abgebrochen'} nach ${Math.round(performance.now() - started)} ms`);
    throw reason.step ? reason : new JobAbortedError(reason.reason, key, reason.limit);
  } finally {
    clearTimeout(total);
    clearInterval(watch);
  }
}

/** Räumt auf, ohne einen echten Fehler zu überdecken: ein misslungenes Aufräumen steht im Protokoll, wirft aber nicht. */
export const removeQuietly = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch((error: unknown) => {
    console.error(`[site] Aufräumen von ${dir} fehlgeschlagen`, error);
  });
