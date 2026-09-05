'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createUserAction } from './actions';
import { StartPasswordDialog } from './start-password-dialog';

type Created = { user: { name: string; email: string }; startPassword: string };

export function CreateUserDialog({ roles }: { roles: { id: string; name: string }[] }) {
  const t = useTranslations('users.create');
  const c = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [state, action] = useActionState(createUserAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === 'success' && state.data) {
      setCreated(state.data as Created);
      setOpen(false);
    }
  }, [state]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button><Plus className="size-3.5" aria-hidden />{t('button')}</Button>} />
        <DialogContent className="w-[560px] bg-surface p-0 shadow-md">
          <form action={action}>
            <div className="p-6">
              <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-ink">{t('subtitle')}</DialogDescription>
              {state.status === 'error' && Object.keys(errors).length === 0 ? (
                <p role="alert" className="mt-3 rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">
                  {state.message}
                </p>
              ) : null}
              <fieldset className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <legend className="px-1 text-[13px] font-semibold text-ink-2">{t('roles')}</legend>
                <div className="flex flex-wrap gap-4">
                  {roles.map((role) => (
                    <div key={role.id} className="flex items-center gap-2">
                      <Checkbox id={`role-${role.id}`} name="roleIds" value={role.id} />
                      <Label htmlFor={`role-${role.id}`}>{role.name}</Label>
                    </div>
                  ))}
                </div>
              </fieldset>
              <div className="mt-4 grid gap-3.5 md:grid-cols-2">
                <FormField id="name" label={t('name')} error={errors.name}>
                  <Input id="name" name="name" required />
                </FormField>
                <FormField id="email" label={t('email')} error={errors.email}>
                  <Input id="email" name="email" type="email" required />
                </FormField>
              </div>
            </div>
            <DialogFooter className="items-center border-t border-line bg-surface-2 px-6 py-3">
              <span className="mr-auto text-[12px] text-muted-ink">{c('audited')}</span>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {c('cancel')}
              </Button>
              <SubmitButton>{t('submit')}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {created ? (
        <StartPasswordDialog
          open
          onClose={() => setCreated(null)}
          name={created.user.name}
          email={created.user.email}
          startPassword={created.startPassword}
        />
      ) : null}
    </>
  );
}
