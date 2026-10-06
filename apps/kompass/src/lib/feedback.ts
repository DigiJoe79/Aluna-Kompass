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
  } catch {
    return { status: 'error', kind: 'network', message: networkMessage, fieldErrors: {} };
  }
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
