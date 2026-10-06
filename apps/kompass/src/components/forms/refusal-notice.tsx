'use client';

import { useTranslations } from 'next-intl';
import { Notice } from '@/components/notice';
import { isRefusal, type ActionState } from '@/lib/actions';

/**
 * Die Ablehnung des Dienstes als `Notice level="refuse"`, fest befüllt: Titel
 * „Nicht gespeichert“ (mit `action`: „Nicht möglich“), Grund, höchstens drei
 * Auswege. Feldfehler und Netzprobleme zeigt sie nicht.
 */
export function RefusalNotice({ state, action }: { state: ActionState; action?: boolean }) {
  const c = useTranslations('common');
  if (!isRefusal(state)) return null;
  const title = state.title ?? c(action ? 'refused.titleAction' : 'refused.title');
  return (
    <Notice level="refuse" title={title} remedies={state.remedies?.slice(0, 3)} reasons={state.reasons}>
      {state.detail ?? state.message}
    </Notice>
  );
}
