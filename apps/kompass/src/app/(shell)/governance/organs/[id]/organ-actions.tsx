'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RecordActions } from '@/components/record-actions';
import { setOrganActiveAction } from '../actions';

/**
 * ⋯ am Organ (MUSTER § C): „Archivieren …“ bzw. „Wieder aktivieren“. Versammlung und Vorstand behalten den Eintrag;
 * der Dialog nennt den Grund, warum es sie immer geben muss (Keine Sperre ohne Grund).
 */
export function OrganActions({ organId, active, required }: { organId: string; active: boolean; required: boolean }) {
  const t = useTranslations('governance.organ');
  const router = useRouter();
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <RecordActions triggerRef={more} actions={[{ key: 'archive', label: active ? t('archiveMenu') : t('activate'), kind: 'reversible', onSelect: () => setOpen(true) }]} />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={active ? t('archiveTitle') : t('activateTitle')}
        description={required ? t('requiredReason') : active ? t('archiveDescription') : t('activateDescription')}
        confirmLabel={active ? t('archive') : t('activate')}
        finalFocus={more}
        {...(required && active ? { refusal: { message: t('requiredReason') } } : {})}
        action={async () => {
          const result = await setOrganActiveAction(organId, !active);
          if (result.status === 'success') router.refresh();
          return result;
        }}
      />
    </>
  );
}
