'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { setProjectFinanceAction } from './finance-actions';

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
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await setProjectFinanceAction({
      projectId,
      targetCents: targetText.trim() === '' ? null : parseAmount(targetText),
      defaultPurposeId: defaultPurposeId === '' ? null : defaultPurposeId,
      abroad,
      publishDonationStatus,
    });
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      toast.error(result.message);
      return;
    }
    if (result.status === 'success' && result.message) toast.success(result.message);
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
          <DialogContent className="bg-surface shadow-md sm:max-w-[420px]">
            <DialogTitle className="font-heading text-[18px]">{t('title')}</DialogTitle>
            <div className="space-y-3.5">
              {error ? <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{error}</div> : null}
              <div className="space-y-1.5">
                <Label htmlFor="project-finance-target">{t('target')}</Label>
                <AmountField id="project-finance-target" name="target" value={targetText} onChange={setTargetText} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-finance-purpose">{t('purpose')}</Label>
                <Select id="project-finance-purpose" value={defaultPurposeId} onChange={(e) => setDefaultPurposeId(e.target.value)}>
                  <option value="">{t('purposeNone')}</option>
                  {purposes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="project-finance-abroad" checked={abroad} onChange={(e) => setAbroad(e.target.checked)} className="size-4 rounded border-line" />
                <Label htmlFor="project-finance-abroad" className="cursor-pointer text-[13px]">
                  {t('abroad')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="project-finance-publish"
                  checked={publishDonationStatus}
                  onChange={(e) => setPublishDonationStatus(e.target.checked)}
                  className="size-4 rounded border-line"
                />
                <Label htmlFor="project-finance-publish" className="cursor-pointer text-[13px]">
                  {t('publishDonationStatus')}
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="button" disabled={pending} onClick={() => void submit()}>
                {t('save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
