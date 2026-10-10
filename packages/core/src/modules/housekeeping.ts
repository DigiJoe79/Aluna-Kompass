import type { Deps } from '../deps';

/** Wie oft aufgeräumt wird. Fristen sind Stunden und Tage; zehn Minuten Verzug sind belanglos. */
export const HOUSEKEEPING_INTERVAL_MS = 10 * 60_000;

/** Ruft `housekeeping` jedes installierten Moduls nacheinander. Ein Fehler hält die anderen nicht auf. */
export async function runHousekeeping(deps: Deps): Promise<{ module: string; error: string | null }[]> {
  const results: { module: string; error: string | null }[] = [];
  for (const manifest of deps.registry.manifests) {
    if (!manifest.housekeeping) continue;
    try {
      await manifest.housekeeping(deps);
      results.push({ module: manifest.key, error: null });
    } catch (error) {
      results.push({ module: manifest.key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export interface Housekeeper {
  wake(): void;
  stop(): Promise<void>;
}

/**
 * Der Takt des Aufräumens, gebaut wie der Textworker der Akte (`startTextWorker`): ein Durchlauf zur Zeit,
 * `unref`, `stop()` wartet auf den laufenden Durchlauf, damit der E2E-Reset danach die Datenbank schließen kann.
 */
export function startHousekeeping(getDeps: () => Deps, opts: { intervalMs?: number } = {}): Housekeeper {
  let busy = false;
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const pass = async (): Promise<void> => {
    busy = true;
    try {
      for (const r of await runHousekeeping(getDeps())) {
        if (r.error) console.warn(`[kompass] Aufräumen ${r.module} —`, r.error);
      }
    } catch (error) {
      // getDeps() wirft während des E2E-Resets; der nächste Takt holt es nach.
      console.warn('[kompass] Aufräumen übersprungen —', error instanceof Error ? error.message : error);
    } finally {
      busy = false;
    }
  };
  const run = (): void => {
    if (busy || stopped) return;
    current = pass();
  };
  const timer = setInterval(run, opts.intervalMs ?? HOUSEKEEPING_INTERVAL_MS);
  timer.unref?.();
  run();
  return {
    wake: run,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      return current;
    },
  };
}
