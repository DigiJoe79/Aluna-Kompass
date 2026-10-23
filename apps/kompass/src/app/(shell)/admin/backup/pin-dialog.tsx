'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type RefObject } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { BackupRow } from '@/lib/backup-view';
import { pinBackupAction } from './actions';

const MAX = 60;
/** Der Zähler erscheint erst kurz vor der Grenze (Nachtrag Designer 6a). */
const COUNTER_FROM = 50;

/**
 * Festhalten mit kurzem Namen bzw. den Namen ändern (Nachtrag Designer 6a): Dialog `sm`, Fokus im Feld, Zähler ab 50
 * Zeichen. Ein leeres Feld beim Umbenennen entfernt den Namen (Dienst). Eine Ablehnung bleibt im Dialog.
 */
export function PinDialog({
  row,
  mode,
  pinnedCount,
  pinnedMax,
  onClose,
  finalFocus,
}: {
  row: BackupRow;
  mode: 'pin' | 'rename';
  pinnedCount: number;
  pinnedMax: number;
  onClose(): void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('backup.pin');
  const fmt = useDateFormat();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(mode === 'rename' ? (row.pinnedLabel ?? '') : '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const save = async () => {
    setPending(true);
    const trimmed = label.trim();
    const state = await feedback.run(() => pinBackupAction({ name: row.name, ...(trimmed || mode === 'rename' ? { label: trimmed } : {}) }));
    setPending(false);
    if (state.status === 'success') onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" initialFocus={input} finalFocus={finalFocus}>
        <div className="flex flex-col gap-4">
          <DialogTitle>{mode === 'rename' ? t('renameTitle') : t('title')}</DialogTitle>
          <DialogDescription>{t('text', { when: fmt.dateTime(row.createdAt), count: mode === 'rename' ? pinnedCount : pinnedCount + 1, max: pinnedMax })}</DialogDescription>
          <FormField id="backup-pin-label" label={t('label')} hint={t('hint')}>
            <Input ref={input} id="backup-pin-label" value={label} maxLength={MAX} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />
          </FormField>
          <p aria-live="polite" className="-mt-2 text-hint text-muted-ink">
            {label.length >= COUNTER_FROM ? t('counter', { count: label.length }) : null}
          </p>
          <FormActionBar placement="dialog" mode="run" cancel={onClose} onSave={() => void save()} pending={pending} saveLabel={mode === 'rename' ? t('saveRename') : t('save')} state={feedback.state} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
