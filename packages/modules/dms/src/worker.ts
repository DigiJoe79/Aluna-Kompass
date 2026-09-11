import { systemContext, type Deps } from '@kompass/core';
import { and, asc, eq, notInArray } from 'drizzle-orm';
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
 * Was auf `unavailable` steht, wartet nicht auf einen Menschen, sondern auf die
 * Werkzeuge (Spec § 15). Sind sie da, kommt es von selbst zurück in die
 * Schlange — sonst stünde auf dem Bildschirm „Sobald sie da sind, wird das
 * Dokument von selbst gelesen“ und es geschähe nichts.
 *
 * Gefragt wird nur, wenn überhaupt etwas liegt, und die Antwort entscheidet:
 * Fehlen die Werkzeuge weiter, bleibt alles, wo es ist. Eine Schleife kann
 * daraus nicht werden.
 */
export async function requeueUnavailable(deps: Deps): Promise<number> {
  const waiting = deps.db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.textStatus, 'unavailable'))
    .all();
  if (waiting.length === 0) return 0;

  const probe = await deps.textExtraction.probe();
  if (!probe.ok) return 0;

  for (const row of waiting) {
    deps.db
      .update(documents)
      .set({ textStatus: 'pending', textError: null })
      .where(eq(documents.id, row.id))
      .run();
  }
  return waiting.length;
}

export type DocumentOutcome = 'idle' | 'done' | 'failed' | 'unavailable';

/**
 * Genau ein Dokument abarbeiten. Eins zur Zeit ist Absicht: Auf der NAS-CPU
 * rendert nebenher Typst, und zwei parallele Tesseract-Läufe nehmen sich
 * gegenseitig die Luft.
 *
 * `skip` sind die Dokumente, die in dieser Runde schon gescheitert sind. Ein
 * Fehlschlag setzt auf `pending` zurück, und das Gescheiterte ist das älteste —
 * ohne diese Menge griffe die Runde sofort wieder danach.
 */
export async function processNextDocument(
  deps: Deps,
  skip: ReadonlySet<string> = new Set(),
): Promise<{ status: DocumentOutcome; documentId: string | null }> {
  const next = deps.db
    .select({ id: documents.id })
    .from(documents)
    .where(
      skip.size > 0
        ? and(eq(documents.textStatus, 'pending'), notInArray(documents.id, [...skip]))
        : eq(documents.textStatus, 'pending'),
    )
    .orderBy(asc(documents.createdAt))
    .limit(1)
    .get();
  if (!next) return { status: 'idle', documentId: null };

  const ctx = systemContext({ permissions: ['dms.manage'] });

  const result = await extractDocumentText(deps, ctx, { documentId: next.id });
  if (!result.ok) return { status: 'failed', documentId: next.id };
  return { status: result.value.status, documentId: next.id };
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
      // Erst nachsehen, ob die Werkzeuge inzwischen da sind.
      await requeueUnavailable(getDeps());

      // Ein Fehlschlag setzt das Dokument auf `pending` zurück, und es ist das
      // älteste. Es in derselben Runde erneut zu nehmen, verbrauchte die drei
      // Versuche in Millisekunden — ein vorübergehender Fehler bekäme nie eine
      // zweite Chance. Der Takt ist der Backoff.
      //
      // Die Runde endet deshalb aber **nicht**: Ein einzelnes zerschossenes PDF
      // blockierte sonst alles hinter sich, und beim nächsten Takt wieder, weil
      // es das älteste bleibt. Drei Versuche wären drei blockierte Takte — ein
      // frisch abgelegter Scan käme erst nach einer Minute in den Index.
      // Übersprungen wird nur, was in dieser Runde schon gescheitert ist.
      //
      // `unavailable` beendet die Runde dagegen sehr wohl: Fehlen die
      // Werkzeuge, ist auch für jedes andere Dokument nichts zu holen.
      const failed = new Set<string>();
      for (;;) {
        if (stopped) break;
        const { status, documentId } = await processNextDocument(getDeps(), failed);
        if (status === 'idle' || status === 'unavailable') break;
        if (status === 'failed' && documentId) failed.add(documentId);
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
