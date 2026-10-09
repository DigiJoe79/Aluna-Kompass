'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
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
  refusal,
  finalFocus,
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
  /**
   * Fachlich nicht möglich (Spec Seitenkopf § 3.4, „keine Sperre ohne Grund“): Der Eintrag, der den Dialog öffnet,
   * bleibt sichtbar; der Dialog nennt den Grund als `Notice level="refuse"` — das ist zugleich seine Beschreibung —
   * und hat nur „Schließen“. `description`, `children` und der Hauptknopf entfallen.
   */
  refusal?: { message: string };
  /** Wohin der Fokus nach dem Schließen geht — der Auslöser ⋯, wenn der Dialog aus `RecordActions` kam. */
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const c = useTranslations('common');
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
      {/* Bei `refusal` ohne Kreuz: Zwei Knöpfe „Schließen“ nebeneinander wären für einen Vorleser einer zu viel (Board § K, Ziel 7). */}
      <DialogContent role={role} size="sm" className="bg-surface shadow-md" finalFocus={finalFocus} showCloseButton={!refusal}>
        <DialogTitle>{title}</DialogTitle>
        {refusal ? (
          <>
            <DialogDescription render={<div />}>
              <Notice level="refuse">{refusal.message}</Notice>
            </DialogDescription>
            {/* Dialog ohne Hauptaktion (nur Schließen), MUSTER § B. */}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} autoFocus>
                {c('close')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogDescription tone="body">{description}</DialogDescription>
            {children}
            <RefusalNotice action state={feedback.state} />
            <FormActionBar placement="dialog" mode="run" cancel={close} onSave={() => void confirm()} pending={pending} saveDisabled={confirmDisabled} saveLabel={confirmLabel} destructive={destructive} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
