'use client';

import type { TeamMemberRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { saveTeamMemberAction } from './actions';

export function TeamMemberDialog({ member, trigger }: { member: TeamMemberRecord | null; trigger: React.ReactElement }) {
  const t = useTranslations('website.team.form');
  const c = useTranslations('website.common');
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveTeamMemberAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') { toast.success(state.message ?? ''); setOpen(false); } }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="w-[640px] bg-surface shadow-md">
        <form action={action} className="grid gap-4 md:grid-cols-2">
          <DialogTitle className="font-heading text-[19px] md:col-span-2">{member ? t('editTitle') : t('createTitle')}</DialogTitle>
          {member ? <input type="hidden" name="id" value={member.id} /> : null}
          {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error md:col-span-2">{state.message}</p> : null}
          <FormField id="name" label={t('name')} error={errors.name} className="md:col-span-2"><Input id="name" name="name" defaultValue={member?.name ?? ''} required /></FormField>
          <LocalizedField name="position" label={t('position')} value={member?.position ?? { de: '', en: '' }} required errors={errors} />
          <div className="md:col-span-2"><MediaPicker name="photoAssetId" value={member?.photoAssetId ?? null} label={t('photo')} /></div>
          <div className="md:col-span-2"><MediaPicker name="petPhotoAssetId" value={member?.petPhotoAssetId ?? null} label={t('petPhoto')} /></div>
          <DialogFooter className="md:col-span-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{c('back')}</Button><SubmitButton>{c('save')}</SubmitButton></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
