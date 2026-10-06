'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createUserAction } from './actions';
import { StartPasswordDialog } from './start-password-dialog';
import { ActionForm } from '@/components/forms/action-form';

type Created = { user: { name: string; email: string }; startPassword: string };

export function CreateUserDialog({ roles }: { roles: { id: string; name: string; grantable: boolean }[] }) {
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
        <DialogTrigger render={<Button>{t('button')}</Button>} />
        <DialogContent size="md" className="bg-surface shadow-md">
          <ActionForm action={action} state={state}>
            <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('subtitle')}</DialogDescription>
            <section className="mt-4">
              <h3 className="text-[15px] font-semibold">{t('person')}</h3>
              <div className="mt-3">
                <FormGrid>
                  <FormField id="name" label={t('name')} error={errors.name}>
                    <Input id="name" name="name" required />
                  </FormField>
                  <FormField id="email" label={t('email')} error={errors.email}>
                    <Input id="email" name="email" type="email" required />
                  </FormField>
                </FormGrid>
              </div>
            </section>
            <section role="group" aria-labelledby="create-user-roles" className="mt-5 border-t border-line pt-5">
              <h3 id="create-user-roles" className="text-[15px] font-semibold">{t('roles')}</h3>
              <div className="mt-3 flex flex-wrap gap-4">
                {roles.map((role) => (
                  <div key={role.id} className="flex items-center gap-2">
                    <Checkbox id={`role-${role.id}`} name="roleIds" value={role.id} disabled={!role.grantable} />
                    <Label htmlFor={`role-${role.id}`}>{role.name}</Label>
                  </div>
                ))}
              </div>
            </section>
            <FormActionBar placement="dialog" mode="create" cancel={() => setOpen(false)} saveLabel={t('submit')} note={c('audited')} state={state} />
          </ActionForm>
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
