'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RecordActions } from '@/components/record-actions';
import { deleteExpenseDraftAction } from '../actions';

/**
 * Seltene Aktion am eigenen Auslagen-Entwurf im Seitenkopf (MUSTER § C, 08 A2, Joe 2026-10-16): „Entwurf löschen …“
 * mit Rückfrage. Ein leerer Entwurf wird nie von selbst verworfen. Vorlage: `projects/project-actions.tsx`.
 */
export function DraftActions({ id }: { id: string }) {
  const t = useTranslations('finance.expenses.new.deleteDraft');
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <RecordActions triggerRef={trigger} actions={[{ key: 'delete', label: t('item'), kind: 'delete', onSelect: () => setOpen(true), testId: 'delete-draft-trigger' }]} />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        finalFocus={trigger}
        title={t('title')}
        description={t('description')}
        confirmLabel={t('confirm')}
        destructive
        action={async () => {
          const state = await deleteExpenseDraftAction(id);
          if (state.status === 'success') router.push('/finance/expenses');
          return state;
        }}
      />
    </>
  );
}
