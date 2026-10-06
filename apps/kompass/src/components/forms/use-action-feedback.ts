'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { idleState, type ActionState } from '@/lib/actions';
import { runAction } from '@/lib/feedback';

/**
 * Hält die letzte Ablehnung für Aufrufe ohne `useActionState` (Dialoge ohne
 * Formular, einzelne Knöpfe). Die Ablehnung verschwindet beim nächsten Absenden;
 * Netzprobleme gehen in einen Toast mit „Erneut versuchen“, Erfolge mit Text
 * in einen Erfolgs-Toast.
 */
export function useActionFeedback() {
  const c = useTranslations('common');
  const [state, setState] = useState<ActionState>(idleState);
  const networkMessage = c('network');
  const retryLabel = c('retry');

  const run = useCallback(
    async (fn: () => Promise<ActionState>, opts?: { retry?: () => void }): Promise<ActionState> => {
      setState(idleState);
      const result = await runAction(fn, networkMessage);
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
  return { state, run, reset };
}
