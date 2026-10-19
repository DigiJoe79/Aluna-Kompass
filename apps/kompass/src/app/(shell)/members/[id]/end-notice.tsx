'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { toastUndo } from '@/lib/feedback';
import { endMembershipAction, revokeEndAction } from '../actions';

export interface EndInfo {
  endsOn: string;
  reason: 'resignation' | 'exclusion' | 'struckOff' | 'death' | 'other';
  noticeOn: string | null;
}

/**
 * „Endet am …“ oben auf der Seite (Handoff Mitglieder D1, 3f): Wo das Ende steht, nimmt man es zurück — ohne Rückfrage,
 * der Toast bietet acht Sekunden lang die Gegenaktion (MUSTER § C, `toastUndo`). Danach bleibt „Mitgliedschaft
 * beenden …“ im Menü als dauerhafter Gegenweg.
 */
export function EndNotice({ membershipId, end }: { membershipId: string; end: EndInfo }) {
  const t = useTranslations('members.detail');
  const c = useTranslations('common');
  const { date } = useDateFormat();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const reapply = async (): Promise<ActionState> => {
    const result =
      end.reason === 'resignation'
        ? await endMembershipAction({ membershipId, reason: 'resignation', noticeOn: end.noticeOn ?? end.endsOn, endsOn: end.endsOn, letter: false })
        : await endMembershipAction({ membershipId, reason: end.reason, endsOn: end.endsOn });
    if (result.status === 'success') router.refresh();
    return result;
  };

  const revoke = async () => {
    setPending(true);
    const result = await feedback.run(() => revokeEndAction(membershipId));
    setPending(false);
    if (result.status !== 'success') return;
    router.refresh();
    toastUndo(t('ending.undone'), reapply, { undo: c('undo'), network: c('network') });
  };

  return (
    <div className="space-y-2">
      <RefusalNotice action state={feedback.state} />
      <Notice
        level="warn"
        title={t('ending.title', { date: date(end.endsOn) })}
        testId="member-ending"
        action={
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void revoke()} data-testid="member-revoke-end">
            {t('ending.undo')}
          </Button>
        }
      >
        {end.reason === 'resignation' && end.noticeOn ? t('ending.resignation', { notice: date(end.noticeOn) }) : t('ending.other', { reason: t(`reasons.${end.reason}`) })}
      </Notice>
    </div>
  );
}
