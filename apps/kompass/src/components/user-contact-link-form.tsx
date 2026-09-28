'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { linkUserAction, unlinkUserAction } from '@/app/(shell)/admin/users/actions';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { ActionForm } from '@/components/forms/action-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { idleState } from '@/lib/actions';
import type { LinkControls } from '@/lib/user-contact-link';

/** Nur einfache Daten von der Server-Komponente: IDs, Texte, die Entscheidung `controls`. */
export function UserContactLinkForm({
  userId,
  linked,
  linkedName,
  linkedHref,
  controls,
}: {
  userId: string;
  linked: boolean;
  linkedName: string | null;
  linkedHref: string | null;
  controls: LinkControls;
}) {
  const t = useTranslations('users.contactLink');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedContact | null>(null);
  const [pending, start] = useTransition();

  const [state, action, actionPending] = useActionState(async (prev: Parameters<typeof linkUserAction>[1], formData: FormData) => {
    const res = await linkUserAction(userId, prev, formData);
    if (res.status === 'success') {
      setOpen(false);
      setPicked(null);
    }
    return res;
  }, idleState);

  return (
    <div className="flex flex-col gap-1" data-testid="user-contact-link">
      <div className="flex flex-wrap items-center gap-2">
        {linked ? (
          linkedName && linkedHref ? (
            <Link href={linkedHref} className="underline underline-offset-2">
              {linkedName}
            </Link>
          ) : (
            <span className="text-ink-2">{t('linkedWithoutView')}</span>
          )
        ) : (
          <span className="text-muted-ink">{t('none')}</span>
        )}
        {controls.canLink ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            {t('link')}
          </Button>
        ) : null}
        {controls.canUnlink ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await unlinkUserAction(userId);
                if (res.status === 'success') toast.success(res.message ?? t('ended'));
                else if (res.status === 'error') toast.error(res.message);
              })
            }
          >
            {t('unlink')}
          </Button>
        ) : null}
      </div>
      {controls.reason ? <p className="text-[12px] text-muted-ink">{t(controls.reason)}</p> : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[460px]">
          <ActionForm action={action} state={state} className="space-y-4">
            <DialogTitle className="font-heading text-[19px]">{t('choose')}</DialogTitle>
            {state.status === 'error' ? <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{state.message}</div> : null}
            <ContactPicker id={`link-contact-${userId}`} name="contactId" label={t('choose')} value={picked} onChange={setPicked} required />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={actionPending || !picked}>
                {t('link')}
              </Button>
            </DialogFooter>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}
