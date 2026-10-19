'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RecordActions } from '@/components/record-actions';
import { deleteContactAction } from '../actions';

/**
 * Seltene Aktionen am Kontakt im Seitenkopf (MUSTER § C). „Kontakt löschen …“ steht immer im Menü; vor Ablauf der
 * Aufbewahrung nennt der Dialog die Frist statt still zu sperren (Spec Seitenkopf § 3.4). Die Karte „Aufbewahrung“
 * zeigt nur noch, was den Kontakt hält.
 */
export function ContactActions({ contactId, until, due, held, canAdmit }: { contactId: string; until: string | null; due: boolean; held: boolean; /** „Als Mitglied aufnehmen …“ (Handoff Mitglieder 8c): Modul an, Recht da, keine laufende Mitgliedschaft. */ canAdmit?: boolean }) {
  const t = useTranslations('contacts.retention');
  const tm = useTranslations('contacts');
  const router = useRouter();
  const fmt = useDateFormat();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const refusal = due ? undefined : { message: until ? t('refusedUntil', { date: fmt.date(until) }) : held ? t('deleteBlocked') : t('unknown') };
  return (
    <>
      <RecordActions
        triggerRef={trigger}
        actions={[
          { key: 'admit', label: tm('makeMember'), kind: 'reversible', onSelect: () => router.push(`/members/new?contact=${contactId}`), hidden: !canAdmit, testId: 'contact-make-member' },
          { key: 'delete', label: t('deleteItem'), kind: 'delete', onSelect: () => setOpen(true), testId: 'contact-delete-trigger' },
        ]}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        finalFocus={trigger}
        title={t('confirmTitle')}
        description={t('confirmText')}
        confirmLabel={t('delete')}
        destructive
        refusal={refusal}
        action={() => deleteContactAction(contactId)}
      />
    </>
  );
}
