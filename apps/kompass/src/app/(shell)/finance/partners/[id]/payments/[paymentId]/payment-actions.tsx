'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RecordActions } from '@/components/record-actions';
import { deletePartnerPaymentDraftAction } from '../../../actions';

/** Seltene Aktionen am Entwurf einer Partnerzahlung im Seitenkopf (MUSTER § C): „Entwurf löschen …“, nicht in der Speicherleiste. */
export function PaymentActions({ paymentId, partnerId }: { paymentId: string; partnerId: string }) {
  const t = useTranslations('finance.partners.payment');
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <RecordActions triggerRef={trigger} actions={[{ key: 'deleteDraft', label: t('deleteDraftItem'), kind: 'delete', onSelect: () => setOpen(true), testId: 'payment-delete-draft' }]} />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        finalFocus={trigger}
        title={t('deleteDraftConfirm.title')}
        description={t('deleteDraftConfirm.description')}
        confirmLabel={t('deleteDraft')}
        destructive
        action={async () => {
          const result = await deletePartnerPaymentDraftAction(paymentId, partnerId);
          if (result.status !== 'error') router.push(`/finance/partners/${partnerId}`);
          return result;
        }}
      />
    </>
  );
}
