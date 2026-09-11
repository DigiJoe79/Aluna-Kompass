import type { TextWorker } from '@kompass/module-dms';

/**
 * Hintergrundarbeit anlassen — genau einmal je Prozess.
 *
 * Next ruft `register()` aus `instrumentation.ts` für **jede** Laufzeit auf,
 * also auch für Edge, wo es weder `better-sqlite3` noch `child_process` gibt.
 * Der Wächter darauf ist kein Schmuck, sondern der Unterschied zwischen einem
 * startenden und einem abstürzenden Server.
 */
interface BackgroundState {
  started: boolean;
  worker: TextWorker | null;
  /** Wie der Dienst angelassen wird — gemerkt, damit er sich neu starten lässt. */
  start: (() => TextWorker | void | unknown) | null;
}

const state: BackgroundState = ((
  globalThis as unknown as { __kompassBackground?: BackgroundState }
).__kompassBackground ??= { started: false, worker: null, start: null });

export function textWorker(): TextWorker | null {
  return state.worker;
}

export function resetBackgroundForTests(): void {
  state.started = false;
  state.start = null;
  if (typeof state.worker?.stop === 'function') {
    state.worker.stop();
  }
  state.worker = null;
}

export function backgroundStarted(): boolean {
  return state.started;
}

export function startBackgroundWork(
  opts: { runtime?: string; onStart?: () => TextWorker | void | unknown } = {},
): void {
  const runtime = opts.runtime ?? process.env.NEXT_RUNTIME ?? 'nodejs';
  if (runtime !== 'nodejs') return;
  if (state.started) return;
  state.started = true;
  if (opts.onStart) state.start = opts.onStart;
  const returned = opts.onStart?.();
  state.worker = returned && typeof returned === 'object' && 'wake' in returned ? (returned as TextWorker) : null;
}

/**
 * Den Dienst anhalten und danach wieder anlassen — für den E2E-Reset, der die
 * Datenbank unter ihm wegzieht.
 *
 * Ein angehaltener Worker kann die Deps nicht mitten im Reset neu anlegen, und
 * darum ging es. Der erste Versuch sperrte stattdessen `getDeps()` und liess es
 * werfen; das traf auch gewöhnliche Anfragen, die zufällig in das Fenster
 * liefen, und endete als Fehler im Browser.
 */
export function stopBackgroundWork(): void {
  state.worker?.stop();
  state.worker = null;
  state.started = false;
}

export function restartBackgroundWork(): void {
  const start = state.start;
  if (!start) return;
  startBackgroundWork({ onStart: start });
}
