'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RecordActions } from '@/components/record-actions';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { toastRefusal, toastUndo } from '@/lib/feedback';
import { deletePartnerProfileAction, setPartnerActiveAction } from '../actions';

/**
 * Seltene Aktionen am Partner im Seitenkopf (MUSTER § C). Archivieren lässt sich zurücknehmen und der Gegenweg steht
 * danach dauerhaft im Kopf („Wieder aktivieren“) — deshalb ohne Rückfrage, mit „Rückgängig“ im Toast. Löschen ist
 * unumkehrbar und fragt nach; hängen Zahlungen oder Bescheide daran, bleibt der Eintrag sichtbar und der Dialog nennt
 * den Grund (keine Sperre ohne Grund).
 *
 * Eine Ablehnung des Dienstes beim Archivieren geht als `toastRefusal`: Im Seitenkopf ist über ⋯ kein Platz für einen
 * Kasten (MUSTER § A, Ausnahme R5).
 */
export function PartnerActions({ id, isActive, deletable }: { id: string; isActive: boolean; deletable: boolean }) {
  const t = useTranslations('finance.partners.detail.actions');
  const c = useTranslations('common');
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const feedback = useActionFeedback();

  const setActive = async (next: boolean): Promise<ActionState> => {
    const result = await setPartnerActiveAction(id, next);
    if (result.status === 'success') router.refresh();
    return result;
  };
  const toggle = async (next: boolean) => {
    const result = await feedback.run(() => setActive(next));
    if (result.status !== 'success') return toastRefusal(result);
    toastUndo(next ? t('toast.activated') : t('toast.archived'), () => setActive(!next), { undo: c('undo'), network: c('network') });
  };

  return (
    <>
      {isActive ? null : (
        <Button type="button" variant="outline" onClick={() => void toggle(true)} data-testid="partner-activate-trigger">
          {t('activate')}
        </Button>
      )}
      <RecordActions
        triggerRef={trigger}
        actions={[
          { key: 'archive', label: t('archive'), kind: 'reversible', onSelect: () => void toggle(false), hidden: !isActive, testId: 'partner-archive-trigger' },
          { key: 'delete', label: t('delete'), kind: 'delete', onSelect: () => setDeleteOpen(true), testId: 'partner-delete-trigger' },
        ]}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        finalFocus={trigger}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={t('deleteConfirm')}
        destructive
        refusal={deletable ? undefined : { message: t('deleteRefused') }}
        action={async () => {
          const result = await deletePartnerProfileAction(id);
          if (result.status === 'success') router.push('/finance/partners');
          return result;
        }}
      />
    </>
  );
}
