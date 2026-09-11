import { systemContext, type Deps } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { documents } from './schema';
import { extractDocumentText } from './text';

/** Wie oft nachgesehen wird, wenn niemand antippt. */
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Was beim Start auf `running` steht, kann kein laufender Lauf sein — der
 * Prozess, der es gesetzt hat, lebt nicht mehr. Zurück in die Schlange.
 *
 * Gefahrlos, weil ein Lauf die Zeilen seines Dokuments ohnehin löscht und neu
 * schreibt (Spec § 5.3).
 */
export function recoverRunning(deps: Deps): number {
  try {
    const stuck = deps.db.select({ id: documents.id }).from(documents).where(eq(documents.textStatus, 'running')).all();
    for (const row of stuck) {
      deps.db.update(documents).set({ textStatus: 'pending' }).where(eq(documents.id, row.id)).run();
    }
    return stuck.length;
  } catch (error) {
    warn('Aufräumen übersprungen', error);
    return 0;
  }
}

/**
 * Ein Abbruch im Hintergrund darf den Prozess nicht mitnehmen — verschwinden
 * darf er aber auch nicht. Ohne diese Zeile im Protokoll steht man vor einem
 * roten Prüfring ohne Spur.
 */
function warn(what: string, error: unknown): void {
  console.warn(`[kompass] Textworker: ${what} —`, error instanceof Error ? error.message : error);
}

/**
 * Genau ein Dokument abarbeiten. Eins zur Zeit ist Absicht: Auf der NAS-CPU
 * rendert nebenher Typst, und zwei parallele Tesseract-Läufe nehmen sich
 * gegenseitig die Luft.
 */
export async function processNextDocument(deps: Deps): Promise<'idle' | 'done' | 'failed' | 'unavailable'> {
  const next = deps.db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.textStatus, 'pending'))
    .orderBy(asc(documents.createdAt))
    .limit(1)
    .get();
  if (!next) return 'idle';

  const ctx = systemContext({ permissions: ['dms.manage'] });

  const result = await extractDocumentText(deps, ctx, { documentId: next.id });
  if (!result.ok) return 'failed';
  return result.value.status;
}

export interface TextWorker {
  /** Sofort nachsehen, statt auf den nächsten Takt zu warten. */
  wake(): void;
  stop(): void;
}

export function startTextWorker(
  depsOrGetter: Deps | (() => Deps),
  opts: { intervalMs?: number } = {},
): TextWorker {
  const getDeps = typeof depsOrGetter === 'function' ? depsOrGetter : () => depsOrGetter;
  try {
    recoverRunning(getDeps());
  } catch (error) {
    // `getDeps()` wirft, solange der E2E-Reset läuft. Der Start darf daran
    // nicht scheitern — er hinge sonst am Serverstart. Der Takt holt es nach.
    warn('Start ohne Aufräumen', error);
  }

  let busy = false;
  let stopped = false;

  const drain = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    try {
      // Solange etwas da ist, weitermachen — aber immer nur eins auf einmal.
      let outcome = await processNextDocument(getDeps());
      while (outcome !== 'idle' && outcome !== 'unavailable' && !stopped) {
        outcome = await processNextDocument(getDeps());
      }
    } catch (error) {
      // Unerwartete Fehler (z. B. geschlossene DB beim Herunterfahren, oder
      // gesperrte Deps während des E2E-Resets) dürfen nicht als
      // unhandledRejection den Prozess abbrechen.
      warn('Durchlauf abgebrochen', error);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void drain(), opts.intervalMs ?? DEFAULT_INTERVAL_MS);
  // Der Takt darf den Prozess nicht am Leben halten, wenn sonst nichts läuft.
  timer.unref?.();
  void drain();

  return {
    wake: () => void drain(),
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
