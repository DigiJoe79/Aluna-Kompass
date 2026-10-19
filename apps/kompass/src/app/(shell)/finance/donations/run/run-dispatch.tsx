'use client';

import type { ConfirmationRunDispatchState } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { DispatchStep } from '@/components/dispatch-step';
import { runItemKindKey } from '@/lib/finance/run-item-kind';
import { markRunPostAction, resendRunMailAction, moveRunLettersAction, sendRunMailsAction } from './actions';

/**
 * Der Versand im Schritt „Ergebnis“ des Serienlaufs (Handoff 2b E3, 20c): der gemeinsame Baustein der Läufe mit den
 * Diensten der Finanzen. Ohne maschinelles Verfahren steht alles in der Post-Gruppe, mit Grund.
 */
export function ConfirmationRunDispatch({ runId, state, canSend, canMark, today }: { runId: string; state: ConfirmationRunDispatchState; canSend: boolean; canMark: boolean; today: string }) {
  const t = useTranslations('finance.donations.run');
  const detail = (row: { kind: Parameters<typeof runItemKindKey>[0]; lineCount: number }) => t(`itemKind.${runItemKindKey(row.kind, row.lineCount)}`);
  return (
    <DispatchStep
      mail={state.mail.map((m) => ({ documentId: m.documentId, documentNumber: m.documentNumber, name: m.name, detail: detail(m), sentAt: m.sentAt, address: m.address, state: m.state, outboxId: m.outboxId, errorText: m.errorText, errorCode: m.errorCode }))}
      post={state.post.map((p) => ({ documentId: p.documentId, documentNumber: p.documentNumber, name: p.name, detail: detail(p), sentAt: p.sentAt, reason: p.reason, dispatched: p.dispatched }))}
      done={state.done}
      mailState={state.mailState}
      canSend={canSend}
      canMark={canMark}
      today={today}
      printHref={`/finance/donations/run/${encodeURIComponent(runId)}/bundle?part=post`}
      documentHref={(id) => `/dms/${id}`}
      onSendAll={() => sendRunMailsAction(runId)}
      onMark={(documentIds, sentAt) => markRunPostAction({ runId, documentIds, sentAt })}
      onResend={(outboxId) => resendRunMailAction(outboxId)}
      onMove={(documentIds, to) => moveRunLettersAction({ runId, documentIds, to })}
      runRef={`financeConfirmationRun:${runId}`}
      countLabel={(count) => t('dispatchCount', { count })}
    />
  );
}
