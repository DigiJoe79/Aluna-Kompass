'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** „Wieder öffnen …“ (Designer-README 4c, Annahme 7): Pflicht-Begründung, die am Zweck steht — nie im Änderungsprotokoll. */
export function ReopenDialog({ name, pending, onClose, onConfirm }: { name: string; pending: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const t = useTranslations('finance.purposes.reopenDialog');
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[440px]">
        <DialogTitle className="font-heading text-[19px]">
          {t('title')}: {name}
        </DialogTitle>
        <div className="space-y-1.5" data-testid="reopen-dialog">
          <Label htmlFor="purpose-reopen-reason" required>
            {t('reason')}
          </Label>
          <Textarea id="purpose-reopen-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-[12px] text-muted-ink">{t('hint')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={pending || reason.trim() === ''} onClick={() => onConfirm(reason.trim())} data-testid="reopen-save">
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
