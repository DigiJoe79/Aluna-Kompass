import { unstable_rethrow } from 'next/navigation';
import { toast } from 'sonner';
import { isRefusal, type ActionState } from './actions';

/**
 * Eine Server Action, die wirft, hat den Server nie erreicht oder keine Antwort
 * bekommen (Netz, Neustart). Das ist keine Ablehnung des Dienstes: Die Eingaben
 * stimmen, nur der Weg nicht — deshalb ein Toast mit „Erneut versuchen“ statt
 * eines Kastens über dem Knopf (MUSTER.md § A).
 */
export async function runAction(fn: () => Promise<ActionState>, networkMessage: string): Promise<ActionState> {
  try {
    // Eine Aktion, die weiterleitet (`redirect`), liefert dem Aufrufer nichts zurück — das ist ein Erfolg, kein Absturz.
    return (await fn()) ?? { status: 'success' };
  } catch (error) {
    // Direkt aufgerufen (nicht über `<form action>`), meldet Next eine Weiterleitung als Fehler `NEXT_REDIRECT` und
    // navigiert trotzdem selbst. Das war nach dem Backup-Import ein Netz-Toast mit „Erneut versuchen“ — das den Import
    // wiederholt hätte (Befund 19 in 0.2.9). Erkannt über die öffentliche `unstable_rethrow`.
    if (isNextNavigation(error)) return { status: 'success' };
    return { status: 'error', kind: 'network', message: networkMessage, fieldErrors: {} };
  }
}

/**
 * Umkehrbare Aktion ohne Rückfrage (MUSTER § C, Designer 2026-10-08): ein Toast mit „Rückgängig“, 8 s, pausiert bei
 * Hover/Fokus (Sonner), Tastatur über Alt+T. Nur einer zugleich — die feste Kennung ersetzt den vorigen. „Rückgängig“
 * ruft die Gegenaktion beim Dienst auf (das Protokoll bleibt ehrlich); der Gegenweg steht zusätzlich dauerhaft auf der
 * Seite. Lehnt der Dienst die Gegenaktion ab, bleibt der Grund als Toast stehen — der Auslöser ist dann der Toast
 * selbst, über ihm ist kein Platz (Erlaubnisliste `no-refusal-toast`).
 */
export function toastUndo(message: string, undo: () => Promise<ActionState>, labels: { undo: string; network: string }): void {
  toast(message, {
    id: 'record-undo',
    duration: 8000,
    action: {
      label: labels.undo,
      onClick: async () => {
        const result = await runAction(undo, labels.network);
        if (result.status === 'error') toast.error(result.title ?? result.message, { description: result.title ? result.message : undefined, duration: Infinity, closeButton: true });
      },
    },
  });
}

/** Nur für Stellen ohne Platz über dem Knopf (Rezept R5): bleibt stehen, bis man ihn schließt. */
export function toastRefusal(state: ActionState): void {
  if (!isRefusal(state)) return;
  toast.error(state.title ?? state.message, { description: state.title ? state.message : undefined, duration: Infinity, closeButton: true });
}

/**
 * Für Dialoge, die nur einen Teil der Feldfehler am Feld zeigen: Steht ein
 * Fehler an einem Feld, das die Maske nicht darstellt, wird die Ablehnung als
 * Ganzes über der Leiste gezeigt (statt dass nichts erscheint). `placed`: die
 * Feldnamen, die die Maske selbst anzeigt.
 */
export function withUnplacedFieldErrors(state: ActionState, placed: readonly string[]): ActionState {
  if (state.status !== 'error' || state.kind === 'network') return state;
  const keys = Object.keys(state.fieldErrors);
  if (keys.length === 0 || keys.every((key) => placed.includes(key))) return state;
  return { ...state, fieldErrors: {} };
}

/** Ein Netzproblem (`runAction` lieferte `kind: 'network'`) als Toast ohne Zeitlimit, mit „Erneut versuchen“, wo es einen Wiederholungsweg gibt. */
export function toastNetwork(state: ActionState, retryLabel: string, retry?: () => void): void {
  if (state.status !== 'error' || state.kind !== 'network') return;
  toast.error(state.message, { duration: Infinity, closeButton: true, action: retry ? { label: retryLabel, onClick: retry } : undefined });
}

/** Ein Fehler, mit dem Next selbst navigiert (`redirect`, `notFound` …) — `unstable_rethrow` wirft genau diese weiter. */
function isNextNavigation(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}
