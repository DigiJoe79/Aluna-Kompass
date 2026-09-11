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
}

const state: BackgroundState = ((
  globalThis as unknown as { __kompassBackground?: BackgroundState }
).__kompassBackground ??= { started: false });

export function resetBackgroundForTests(): void {
  state.started = false;
}

export function backgroundStarted(): boolean {
  return state.started;
}

export function startBackgroundWork(
  opts: { runtime?: string; onStart?: () => void } = {},
): void {
  const runtime = opts.runtime ?? process.env.NEXT_RUNTIME ?? 'nodejs';
  if (runtime !== 'nodejs') return;
  if (state.started) return;
  state.started = true;
  opts.onStart?.();
}
