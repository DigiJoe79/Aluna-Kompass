'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { linkUserAction } from '@/app/(shell)/admin/users/actions';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { ActionForm } from '@/components/forms/action-form';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { idleState } from '@/lib/actions';
import type { LinkControls } from '@/lib/user-contact-link';

/**
 * Dialog „Kontakt wählen“ der Nutzerverwaltung; geöffnet aus dem Zeilenmenü (Runde 3, 155). Der Satz zur eigenen
 * Verknüpfung steht hier, nicht in der Zeile (11-1 B27).
 */
export function UserContactLinkDialog({
  userId,
  reason,
  open,
  onOpenChange,
}: {
  userId: string;
  reason: LinkControls['reason'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('users.contactLink');
  const [picked, setPicked] = useState<PickedContact | null>(null);
  const [state, action] = useActionState(async (prev: Parameters<typeof linkUserAction>[1], formData: FormData) => {
    const res = await linkUserAction(userId, prev, formData);
    if (res.status === 'success') {
      onOpenChange(false);
      setPicked(null);
    }
    return res;
  }, idleState);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <ActionForm action={action} state={state} className="space-y-4">
          <DialogTitle>{t('choose')}</DialogTitle>
          {reason ? <DialogDescription>{t(reason)}</DialogDescription> : null}
          <ContactPicker id={`link-contact-${userId}`} name="contactId" label={t('choose')} value={picked} onChange={setPicked} required />
          <FormActionBar placement="dialog" mode="create" cancel={() => onOpenChange(false)} saveDisabled={!picked} saveLabel={t('link')} state={state} />
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
