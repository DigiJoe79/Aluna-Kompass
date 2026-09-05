'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export function StartPasswordDialog({
  open,
  onClose,
  name,
  email,
  startPassword,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  email: string;
  startPassword: string;
}) {
  const t = useTranslations('users.startPassword');
  const c = useTranslations('common');
  const [copied, setCopied] = useState(false);

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (!next && details?.reason !== 'escape-key' && details?.reason !== 'outside-press') {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="w-[520px] bg-surface shadow-md"
      >
        <DialogTitle className="font-heading text-[19px]">{t('title', { name })}</DialogTitle>
        <DialogDescription className="text-[14px] text-ink-2">{t('text')}</DialogDescription>
        <div className="rounded-md border border-line-strong bg-code p-3 font-mono">
          <div className="text-[11px] font-semibold tracking-[.06em] text-muted-ink">E-MAIL</div>
          <div className="text-[13px]">{email}</div>
          <div className="mt-2 text-[11px] font-semibold tracking-[.06em] text-muted-ink">STARTPASSWORT</div>
          <div data-testid="start-password" className="text-[15px] font-medium">{startPassword}</div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(`${email}\n${startPassword}`);
              setCopied(true);
            }}
          >
            <Copy className="size-4" aria-hidden />
            {copied ? c('copied') : t('copyBoth')}
          </Button>
        </div>
        <p className="rounded-md border border-info bg-info-bg p-3 text-[13px] text-ink-2">{t('info', { name })}</p>
        <Button onClick={onClose}>{t('done')}</Button>
      </DialogContent>
    </Dialog>
  );
}
