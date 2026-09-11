'use client';

import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Drop } from '../dms-workspace';
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
  index = 0,
  onFiled,
}: {
  types: { key: string; label: string }[];
  folders: string[];
  contacts: { id: string; name: string }[];
  defaultTypeKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drop?: Drop | null;
  /** Welche Datei der Warteschlange gerade dran ist. */
  index?: number;
  onFiled?: () => void;
}) {
  const t = useTranslations('dms');
  const total = drop?.files.length ?? 0;
  const queued = total > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100vh-4rem)] w-[700px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-surface p-0 shadow-md sm:max-w-[700px]">
        <div className="border-b border-line-2 px-6 pt-[18px] pb-3.5">
          <div className="flex items-center gap-2.5">
            <DialogTitle className="font-heading text-[20px] text-ink">{t('receivePost')}</DialogTitle>
            {queued ? (
              <span className="rounded-full bg-badge px-2.5 py-0.5 font-mono text-[12px] text-badge-ink">
                {t('drop.queueBadge', { current: index + 1, total })}
              </span>
            ) : null}
          </div>
          <DialogDescription className="text-[13px] text-ink-2">
            {queued
              ? drop?.folder
                ? t('drop.queueHint', { folder: drop.folder })
                : t('drop.queueHintInbox')
              : t('receiveDescription')}
          </DialogDescription>
        </div>
        <ReceiveForm
          types={types}
          folders={folders}
          contacts={contacts}
          defaultTypeKey={defaultTypeKey}
          droppedFile={drop?.files[index] ?? null}
          droppedFolder={drop?.folder ?? null}
          skipped={index === 0 ? (drop?.skipped ?? 0) : 0}
          queued={queued}
          onFiled={onFiled}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
