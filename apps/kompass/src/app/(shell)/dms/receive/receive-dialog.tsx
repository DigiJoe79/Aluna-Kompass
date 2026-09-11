'use client';

import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ReceiveForm } from './receive-form';

/**
 * „Post ablegen“ liegt über der Liste, statt sie zu verlassen: Wer einsortiert,
 * behält im Blick, wohin. Was ein Zug ins Fenster gebracht hat, steht schon im
 * Formular — die Datei und der Ordner, auf dem sie gelandet ist.
 */
export function ReceiveDialog({
  types,
  folders,
  contacts,
  defaultTypeKey,
  open,
  onOpenChange,
  drop,
}: {
  types: { key: string; label: string }[];
  folders: string[];
  contacts: { id: string; name: string }[];
  defaultTypeKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drop?: { file: File | null; folder: string | null; skipped: number } | null;
}) {
  const t = useTranslations('dms');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          droppedFile={drop?.file ?? null}
          droppedFolder={drop?.folder ?? null}
          skipped={drop?.skipped ?? 0}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
