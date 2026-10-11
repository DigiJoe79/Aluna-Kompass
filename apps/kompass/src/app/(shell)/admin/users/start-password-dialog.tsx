'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { copyToClipboard } from '@/lib/clipboard';
import { Overline } from '@/components/overline';

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
        size="md"
        className="bg-surface shadow-md"
      >
        <DialogTitle>{t('title', { name })}</DialogTitle>
        <DialogDescription tone="body">{t('text')}</DialogDescription>
        <div className="rounded-md border border-line-strong bg-code p-3 font-mono">
          <Overline as="div">{t('emailLabel')}</Overline>
          <div className="text-meta">{email}</div>
          <Overline as="div" className="mt-2">{t('passwordLabel')}</Overline>
          <div data-testid="start-password" className="text-section font-mono tracking-[.04em] select-all">{startPassword}</div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              if (await copyToClipboard(`${email}\n${startPassword}`)) setCopied(true);
              else toast.error(c('copyFailed'), { duration: Infinity, closeButton: true });
            }}
          >
            <Copy className="size-4" aria-hidden />
            {copied ? c('copied') : t('copyBoth')}
          </Button>
        </div>
        <Notice level="hint">{t('info', { name })}</Notice>
        <Button onClick={onClose}>{t('done')}</Button>
      </DialogContent>
    </Dialog>
  );
}
