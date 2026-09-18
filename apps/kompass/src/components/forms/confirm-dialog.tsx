'use client';

import { useTranslations } from 'next-intl';
import { useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
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
  const t = useTranslations('common');
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role={role} className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{title}</DialogTitle>
        <DialogDescription className="text-[14px] text-ink-2">{description}</DialogDescription>
        {children}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending || confirmDisabled}
            onClick={() => start(async () => {
              const state = await action();
              if (state.status === 'error') toast.error(state.message);
              else if (state.status === 'success' && state.message) toast.success(state.message);
              onOpenChange(false);
            })}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
