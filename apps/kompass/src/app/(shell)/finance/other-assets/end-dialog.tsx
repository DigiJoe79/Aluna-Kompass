'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { endOtherAssetAction } from './actions';
import type { OtherAssetRow } from './other-asset-list';

/** „Beenden …“ (Board 11g, Dialog `sm`): Bis — der letzte Tag, an dem er dem Verein gehörte — und ein freier Grund. */
export function EndDialog({ entry, onClose }: { entry: OtherAssetRow; onClose: () => void }) {
  const t = useTranslations('finance.otherAssets.end');
  const router = useRouter();
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => endOtherAssetAction({ id: entry.id, until, reason }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="other-asset-end">
        <DialogHeader>
          <DialogTitle>{t('title', { label: entry.label })}</DialogTitle>
          <DialogDescription tone="meta">{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="end-until" label={t('until')} hint={t('untilHint')} required error={errors.until} size="m">
              <Input id="end-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </FormField>
            <FormField id="end-reason" label={t('reason')} error={errors.reason} size="full">
              <Input id="end-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['until', 'reason'])} />
      </DialogContent>
    </Dialog>
  );
}
