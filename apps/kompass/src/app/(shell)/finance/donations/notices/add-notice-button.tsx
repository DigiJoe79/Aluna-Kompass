'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Button } from '@/components/ui/button';
import { FollowUpDialog } from '../../deadlines/follow-up-dialog';
import { NoticeDialog, type SavedNotice } from './notice-dialog';

/**
 * „Bescheid erfassen“ in der Kopfzeile — öffnet den zweistufigen Dialog. Nach dem ersten Speichern schlägt der Dialog
 * „Kopie des Bescheids der Bank vorlegen“ vor; „Wiedervorlage anlegen …“ schließt ihn und öffnet die vorbelegte
 * Wiedervorlage (Antwort Joe 2026-10-24, ein Dialog zur Zeit).
 */
export function AddNoticeButton({ canPickDocument, canFollowUp = false }: { canPickDocument: boolean; canFollowUp?: boolean }) {
  const t = useTranslations('finance.donations.notices');
  const fmt = useDateFormat();
  const [open, setOpen] = useState(false);
  const [followUp, setFollowUp] = useState<SavedNotice | null>(null);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>{t('add')}</Button>
      <NoticeDialog open={open} onOpenChange={setOpen} canPickDocument={canPickDocument} onFollowUp={canFollowUp ? setFollowUp : undefined} />
      {followUp ? (
        <FollowUpDialog
          open
          onOpenChange={(o) => (o ? undefined : setFollowUp(null))}
          years={[]}
          defaultYearId={null}
          preset={{ title: t('dialog.bankFollowUpTitle'), target: { entityType: 'financeNotice', entityId: followUp.id, label: t('dialog.bankFollowUpTarget', { date: fmt.date(followUp.noticeDate) }) } }}
        />
      ) : null}
    </>
  );
}
