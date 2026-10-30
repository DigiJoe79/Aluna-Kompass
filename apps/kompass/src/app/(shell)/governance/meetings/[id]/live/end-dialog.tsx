'use client';

import { useTranslations } from 'next-intl';
import { useState, type RefObject } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { Notice } from '@/components/notice';
import { Input } from '@/components/ui/input';
import { endMeetingAction } from './actions';

/**
 * „Mitlauf beenden …“ (Board 1a, `sm`): Uhrzeit des Endes, offene Punkte als Hinweis (sperrt nicht). Steht noch etwas
 * in der Warteschlange, geht das Ende nicht hinaus, bis sie leer ist.
 */
export function EndDialog({ open, onOpenChange, meetingId, now, openPoints, pending, finalFocus }: { open: boolean; onOpenChange: (open: boolean) => void; meetingId: string; now: string; openPoints: number; pending: number; finalFocus?: RefObject<HTMLElement | null> }) {
  const t = useTranslations('governance.live.end');
  const [endedAt, setEndedAt] = useState(now);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setEndedAt(now);

        }
        onOpenChange(o);
      }}
      title={t('title')}
      description={t('description')}
      confirmLabel={t('confirm')}
      finalFocus={finalFocus}
      action={async () => {
        if (pending > 0) {

          return { status: 'error', message: t('waiting'), fieldErrors: {} };
        }
        return endMeetingAction(meetingId, endedAt);
      }}
    >
      <div className="flex flex-col gap-3">
        <FormField id="live-ended-at" label={t('endedAt')} required size="s">
          <Input id="live-ended-at" type="time" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
        </FormField>
        {openPoints > 0 ? <Notice level="warn">{t('open', { count: openPoints })}</Notice> : null}
      </div>
    </ConfirmDialog>
  );
}
