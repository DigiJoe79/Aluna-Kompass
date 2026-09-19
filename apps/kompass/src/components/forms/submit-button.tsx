'use client';

import { useContext, type ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { ActionFormPending } from './action-form';

export function SubmitButton({ children, disabled, ...props }: ComponentProps<typeof Button>) {
  // Ein `ActionForm` schickt selbst ab; `useFormStatus` sieht davon nichts.
  const own = useContext(ActionFormPending);
  const status = useFormStatus();
  const pending = own ?? status.pending;
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {children}
    </Button>
  );
}
