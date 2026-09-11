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
}

const state: BackgroundState = ((
  globalThis as unknown as { __kompassBackground?: BackgroundState }
).__kompassBackground ??= { started: false, worker: null });

export function textWorker(): TextWorker | null {
  return state.worker;
}

export function resetBackgroundForTests(): void {
  state.started = false;
  if (typeof state.worker?.stop === 'function') {
    state.worker.stop();
  }
  state.worker = null;
}

export function backgroundStarted(): boolean {
  return state.started;
}

export function startBackgroundWork(
  opts: { runtime?: string; onStart?: () => TextWorker | void } = {},
): void {
  const runtime = opts.runtime ?? process.env.NEXT_RUNTIME ?? 'nodejs';
  if (runtime !== 'nodejs') return;
  if (state.started) return;
  state.started = true;
  const returned = opts.onStart?.();
  state.worker = returned && typeof returned === 'object' && 'wake' in returned ? (returned as TextWorker) : null;
}
