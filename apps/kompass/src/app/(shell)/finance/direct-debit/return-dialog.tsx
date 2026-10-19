'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FixedValue } from '@/components/fixed-value';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Overline } from '@/components/overline';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatEuro } from '@/lib/finance/amount';
import { resolveReturnAction } from './actions';

export interface OpenReturn {
  id: string;
  debtorName: string;
  source: 'openItem' | 'pledge';
  amountCents: number;
  returnCode: string | null;
  suggestEndMandate: boolean;
  feeCents: number;
  /** U4 (Plan N3): Der Beitrag ist inzwischen anders bezahlt — nur „War schon bezahlt“ und „zur Überweisung“ gehen. */
  itemPaid?: boolean;
}

type Resolution = 'recollect' | 'requestTransfer' | 'waive' | 'alreadyPaid';
const RESOLUTIONS: readonly Resolution[] = ['recollect', 'requestTransfer', 'waive'];
const RESOLUTIONS_PAID: readonly Resolution[] = ['alreadyPaid', 'requestTransfer'];

/**
 * Rückgabe klären (Handoff 2a § 1.3 13d, Nachtrag Phase 2 § 1): Dialog `md` mit drei Wegen (ist der Beitrag
 * inzwischen bezahlt, U4: „War schon bezahlt“ und „zur Überweisung“), dem Haken „Mandat beenden“
 * (vorgeschlagen bei `AC04`, `MD01`, `MD06`, mit Hinweis je Code) und der Gebühr der Bank als festem Wert — sie wird
 * nicht weiterberechnet. Ein Dienst: `resolveDirectDebitReturn`.
 */
export function ReturnDialog({ item, onClose }: { item: OpenReturn; onClose: () => void }) {
  const t = useTranslations('finance.directDebit.return');
  const tc = useTranslations('finance.directDebit.returnCodes');
  const router = useRouter();
  const ways = item.itemPaid ? RESOLUTIONS_PAID : RESOLUTIONS;
  const [resolution, setResolution] = useState<Resolution>(item.itemPaid ? 'alreadyPaid' : item.suggestEndMandate ? 'requestTransfer' : 'recollect');
  const [endMandate, setEndMandate] = useState(item.suggestEndMandate);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const feedback = useActionFeedback();
  const code = item.returnCode;
  const reason = code ? (tc.has(code) ? tc(code) : tc('unknown', { code })) : null;

  // M38: Nach einem Widerspruch oder fehlendem Konto/Mandat zieht Kompass nur nach Rückfrage erneut ein.
  const recollectAfterObjection = async () => {
    const result = await resolveReturnAction({ returnId: item.id, resolution: 'recollect', endMandate: false, confirmedAfterObjection: true });
    if (result.status === 'success') {
      toast.success(result.message);
      onClose();
      router.refresh();
    }
    return result;
  };

  const save = async () => {
    if (resolution === 'recollect' && item.suggestEndMandate) {
      setConfirming(true);
      return;
    }
    setPending(true);
    const result = await feedback.run(() => resolveReturnAction({ returnId: item.id, resolution, endMandate: resolution === 'recollect' ? false : endMandate }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" data-testid="return-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { name: item.debtorName })}</DialogTitle>
          <DialogDescription>{t(item.source === 'pledge' ? 'descriptionRate' : 'descriptionFee', { amount: formatEuro(item.amountCents) })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div>
              <Overline as="div" field>
                <span id="return-way-label">{t('way')}</span>
              </Overline>
              <RadioGroup aria-labelledby="return-way-label" value={resolution} onValueChange={(v) => setResolution(v as Resolution)} className="mt-2 gap-3">
                {ways.map((r) => (
                  <label key={r} className="flex cursor-pointer items-start gap-2 text-body text-ink">
                    <RadioGroupItem value={r} className="mt-0.5" />
                    <span className="flex flex-col">
                      {t(`ways.${r}`)}
                      <span className="text-hint text-muted-ink">{t(`ways.${r}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
                <Checkbox checked={resolution !== 'recollect' && endMandate} disabled={resolution === 'recollect'} onCheckedChange={(on) => setEndMandate(on === true)} data-testid="return-end-mandate" />
                {t('endMandate')}
              </label>
              {code ? <p className="text-hint text-muted-ink">{t(item.suggestEndMandate ? 'codeHintEnd' : 'codeHint', { code, reason: reason ?? '' })}</p> : null}
              {resolution === 'recollect' ? <p className="text-hint text-muted-ink">{t('recollectKeepsMandate')}</p> : null}
            </div>
            <FixedValue id="return-fee" label={t('fee')} value={item.feeCents > 0 ? formatEuro(item.feeCents) : null} reason={t(item.feeCents > 0 ? 'feeReason' : 'feeNone')} />
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={feedback.state} testId="return-footer" />
      </DialogContent>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t('recollectConfirmTitle')} description={t('recollectConfirmDescription', { code: code ?? '', reason: reason ?? '' })} confirmLabel={t('recollectConfirm')} action={recollectAfterObjection} />
    </Dialog>
  );
}
