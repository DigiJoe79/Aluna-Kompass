'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { idleState, type ActionState } from '@/lib/actions';
import { runAction } from '@/lib/feedback';

/**
 * Hält die letzte Ablehnung für Aufrufe ohne `useActionState` (Dialoge ohne
 * Formular, einzelne Knöpfe). Die Ablehnung verschwindet beim nächsten Absenden;
 * Netzprobleme gehen in einen Toast mit „Erneut versuchen“, Erfolge mit Text
 * in einen Erfolgs-Toast.
 *
 * `pending` sagt, dass ein Aufruf läuft (Knopf sperren, `aria-busy`). Die Sperre selbst hält ein Ref: Ein zweiter
 * `run` während des ersten ruft `fn` nicht auf, sondern liefert das Ergebnis des laufenden — ein Doppelklick vor dem
 * nächsten Render stellt so kein Dokument zweimal aus (Code-Review 0.4.0, App-B1/B2). Nicht `idle`: Viele Aufrufer
 * lesen „kein Fehler“ als Erfolg und schlössen sonst einen Dialog, dessen Speichern noch abgelehnt werden kann
 * (Abschlussreview R3). Nach Erfolg, Ablehnung und Netzfehler löst sich die Sperre.
 */
export function useActionFeedback() {
  const c = useTranslations('common');
  const [state, setState] = useState<ActionState>(idleState);
  const [pending, setPending] = useState(false);
  const inFlight = useRef<Promise<ActionState> | null>(null);
  const networkMessage = c('network');
  const retryLabel = c('retry');

  const run = useCallback(
    async (fn: () => Promise<ActionState>, opts?: { retry?: () => void }): Promise<ActionState> => {
      if (inFlight.current) return inFlight.current;
      setPending(true);
      setState(idleState);
      const running = runAction(fn, networkMessage);
      inFlight.current = running;
      let result: ActionState;
      try {
        result = await running;
      } finally {
        inFlight.current = null;
        setPending(false);
      }
      if (result.status === 'success') {
        if (result.message) toast.success(result.message);
      } else if (result.status === 'error' && result.kind === 'network') {
        toast.error(result.message, {
          duration: Infinity,
          closeButton: true,
          action: opts?.retry ? { label: retryLabel, onClick: opts.retry } : undefined,
        });
      } else if (result.status === 'error') {
        setState(result);
      }
      return result;
    },
    [networkMessage, retryLabel],
  );

  const reset = useCallback(() => setState(idleState), []);
  return { state, run, reset, pending };
}
