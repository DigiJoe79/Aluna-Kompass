'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ActionState } from '@/lib/actions';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  confirmDisabled,
  role = 'alertdialog',
  action,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  role?: 'dialog' | 'alertdialog';
  action: () => Promise<ActionState>;
  children?: ReactNode;
}) {
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const { reset } = feedback;
  // Jedes Öffnen beginnt ohne die Ablehnung vom letzten Mal.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const close = () => {
    reset();
    onOpenChange(false);
  };

  // Eine Ablehnung hält den Dialog offen und steht im Dialog; nur Erfolg schließt. Netz: Toast mit „Erneut versuchen“, Dialog offen.
  const confirm = async () => {
    setPending(true);
    try {
      const result = await feedback.run(action, { retry: () => void confirm() });
      if (result.status === 'success') onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent role={role} size="sm" className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{title}</DialogTitle>
        <DialogDescription className="text-[14px] text-ink-2">{description}</DialogDescription>
        {children}
        <RefusalNotice action state={feedback.state} />
        <FormActionBar placement="dialog" mode="run" cancel={close} onSave={() => void confirm()} pending={pending} saveDisabled={confirmDisabled} saveLabel={confirmLabel} destructive={destructive} />
      </DialogContent>
    </Dialog>
  );
}
