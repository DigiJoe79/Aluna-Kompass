'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { setProjectFinanceAction } from './finance-actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

export interface FinanceSectionValues {
  targetCents: number | null;
  defaultPurposeId: string | null;
  abroad: boolean;
  publishDonationStatus: boolean;
}

export function FinanceSectionEditor({ projectId, initial, purposes }: { projectId: string; initial: FinanceSectionValues; purposes: { id: string; name: string }[] }) {
  const t = useTranslations('finance.projectSection.dialog');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetText, setTargetText] = useState(initial.targetCents !== null ? formatAmount(initial.targetCents) : '');
  const [defaultPurposeId, setDefaultPurposeId] = useState(initial.defaultPurposeId ?? '');
  const [abroad, setAbroad] = useState(initial.abroad);
  const [publishDonationStatus, setPublishDonationStatus] = useState(initial.publishDonationStatus);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => setProjectFinanceAction({
      projectId,
      targetCents: targetText.trim() === '' ? null : parseAmount(targetText),
      defaultPurposeId: defaultPurposeId === '' ? null : defaultPurposeId,
      abroad,
      publishDonationStatus,
    }), { retry: () => void submit() });
    setPending(false);
    if (result.status !== 'success') return;
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t('title')}
      </Button>
      {open ? (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent size="sm" className="bg-surface shadow-md">
            <DialogTitle>{t('title')}</DialogTitle>
            <FormGrid>
              <FormField id="project-finance-target" label={t('target')} size="s">
                <AmountField id="project-finance-target" name="target" value={targetText} onChange={setTargetText} />
              </FormField>
              <FormField id="project-finance-purpose" label={t('purpose')} size="m">
                <Select id="project-finance-purpose" value={defaultPurposeId} onChange={(e) => setDefaultPurposeId(e.target.value)}>
                  <option value="">{t('purposeNone')}</option>
                  {purposes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="project-finance-abroad" label={t('abroad')} size="m" toggle>
                <Checkbox id="project-finance-abroad" checked={abroad} onCheckedChange={(checked) => setAbroad(checked)} />
              </FormField>
              <FormField id="project-finance-publish" label={t('publishDonationStatus')} size="m" toggle>
                <Checkbox id="project-finance-publish" checked={publishDonationStatus} onCheckedChange={(checked) => setPublishDonationStatus(checked)} />
              </FormField>
            </FormGrid>
            <FormActionBar placement="dialog" cancel={() => setOpen(false)} pending={pending} saveLabel={t('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
