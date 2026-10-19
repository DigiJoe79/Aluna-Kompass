'use client';

import type { RunDispatchState } from '@kompass/module-members';
import { useTranslations } from 'next-intl';
import { DispatchStep } from '@/components/dispatch-step';
import { Notice } from '@/components/notice';
import { markRunPostAction, resendRunMailAction, moveRunLettersAction, sendRunMailsAction } from '../actions';

/** Der Schritt „Versand“ eines Beitrags- oder Mahnlaufs: der gemeinsame Baustein mit den Diensten der Mitglieder. */
export function MemberRunDispatch({ runRef, state, detail, canSend, canMark, today }: { runRef: string; state: RunDispatchState; detail: string | null; canSend: boolean; canMark: boolean; today: string }) {
  const t = useTranslations('members.runDispatch');
  return (
    <>
    {/* F7: stornierte Briefe des Laufs gehen nicht hinaus; der Lauf nennt sie. */}
    {state.voided.length > 0 ? <Notice level="hint" testId="run-voided">{t('voided', { count: state.voided.length, letters: state.voided.map((v) => [v.documentNumber, v.name].filter(Boolean).join(' · ')).join(', ') })}</Notice> : null}
    <DispatchStep
      mail={state.mail.map((m) => ({ documentId: m.documentId, documentNumber: m.documentNumber, name: m.name, detail: m.levelName ?? detail, sentAt: m.sentAt, address: m.address, state: m.state, outboxId: m.outboxId, errorText: m.errorText, errorCode: m.errorCode }))}
      post={state.post.map((p) => ({ documentId: p.documentId, documentNumber: p.documentNumber, name: p.name, detail: p.levelName ?? detail, sentAt: p.sentAt, reason: p.reason, dispatched: p.dispatched }))}
      done={state.done}
      mailState={state.mailState}
      canSend={canSend}
      canMark={canMark}
      today={today}
      printHref={`/members/runs/print?runRef=${encodeURIComponent(runRef)}`}
      documentHref={(id) => `/dms/${id}`}
      onSendAll={() => sendRunMailsAction(runRef)}
      onMark={(documentIds, sentAt) => markRunPostAction({ runRef, documentIds, sentAt })}
      onResend={(outboxId) => resendRunMailAction(outboxId)}
      onMove={(documentIds, to) => moveRunLettersAction({ runRef, documentIds, to })}
      runRef={runRef}
    />
    </>
  );
}
