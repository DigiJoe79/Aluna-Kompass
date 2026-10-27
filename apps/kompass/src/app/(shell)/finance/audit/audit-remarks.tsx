'use client';

import { useRouter } from 'next/navigation';
import { RemarkThread, type RemarkThreadItem } from '@/components/remark-thread';
import type { ActionState } from '@/lib/actions';
import { answerRemarkAction, followUpRemarkAction, resolveRemarkAction } from './actions';

/** `RemarkThread` mit den Aktionen der Kassenprüfung: nach jeder Handlung baut die Seite neu auf. */
export function AuditRemarks({ items, canAnswer, canAudit }: { items: RemarkThreadItem[]; canAnswer: boolean; canAudit: boolean }) {
  const router = useRouter();
  const after = (run: () => Promise<ActionState>) => async () => {
    const result = await run();
    if (result.status === 'success') router.refresh();
    return result;
  };
  return (
    <RemarkThread
      remarks={items}
      canAnswer={canAnswer}
      canAudit={canAudit}
      onAnswer={(id, text) => after(() => answerRemarkAction(id, text))()}
      onFollowUp={(id, text) => after(() => followUpRemarkAction(id, text))()}
      onResolve={(id) => after(() => resolveRemarkAction(id))()}
    />
  );
}
