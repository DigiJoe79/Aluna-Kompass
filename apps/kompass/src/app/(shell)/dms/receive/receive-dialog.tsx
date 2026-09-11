'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ReceiveForm } from './receive-form';

/**
 * „Post ablegen“ liegt über der Liste, statt sie zu verlassen: Wer einsortiert,
 * behält im Blick, wohin. Der Deep-Link `/dms/receive` zeigt denselben Dialog;
 * schliesst man ihn, bleibt die Liste stehen und die Adresse wird wieder `/dms`.
 */
export function ReceiveDialog({
  types,
  folders,
  contacts,
  defaultTypeKey,
  defaultOpen,
}: {
  types: { key: string; label: string }[];
  folders: string[];
  contacts: { id: string; name: string }[];
  defaultTypeKey: string;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('dms');
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(!!defaultOpen);

  const change = (next: boolean) => {
    setOpen(next);
    if (!next && pathname === '/dms/receive') router.replace('/dms');
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{t('receivePost')}</DialogTrigger>
      <DialogContent className="grid max-h-[calc(100vh-4rem)] w-[700px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-surface p-0 shadow-md sm:max-w-[700px]">
        <div className="border-b border-line-2 px-6 pt-[18px] pb-3.5">
          <DialogTitle className="font-heading text-[20px] text-ink">{t('receivePost')}</DialogTitle>
          <DialogDescription className="text-[13px] text-ink-2">{t('receiveDescription')}</DialogDescription>
        </div>
        <ReceiveForm
          types={types}
          folders={folders}
          contacts={contacts}
          defaultTypeKey={defaultTypeKey}
          onCancel={() => change(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
