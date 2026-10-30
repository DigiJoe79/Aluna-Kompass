'use client';

import type { FundsUseOpeningsOverview, FundsUseOpeningView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type RefObject } from 'react';
import { toast } from 'sonner';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { AmountField } from '@/components/finance/amount-field';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { formatAmount, readAmounts, type AmountError } from '@/lib/finance/amount';
import { ResolutionField } from '../reserves/resolution-field';
import { saveFundsUseOpeningAction } from './actions';

/** Ein Jahr früher am selben Tag (Vorgabe des Jahresendes für den zweiten Vortrag). */
const yearBefore = (day: string) => `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`;

const PLACED = ['designation', 'endsOn', 'revenueCents', 'amountCents'] as const;

/**
 * Anfangsvortrag erfassen oder bearbeiten (Plan U2 Task 3; Designer Frage 4, Dialog wie 125 `carry-forward-dialog`):
 * das Jahr steht fest (der nächste freie bzw. der bearbeitete Vortrag, keine Wahl), Bezeichnung, Jahresende, Einnahmen
 * jenes Jahres, noch zu verwenden und Beleg — Pflicht beim Anlegen, beim Bearbeiten bleibt ohne neuen der vorhandene.
 * Die Beträge liest `readAmounts` mit Feldfehler statt stillem Rückfall; die damalige Grenze prüft der Dienst.
 */
export function OpeningDialog({ overview, offset, initial, open, onOpenChange, finalFocus }: { overview: FundsUseOpeningsOverview; offset: 1 | 2; initial: FundsUseOpeningView | null; open: boolean; onOpenChange: (open: boolean) => void; finalFocus?: RefObject<HTMLElement | null> }) {
  const t = useTranslations('finance.fundUse.openings.dialog');
  const tAmount = useTranslations('finance.amount');
  const router = useRouter();
  const offset1 = overview.expectedEndsOn?.offset1 ?? '';
  const defaultEndsOn = offset === 1 ? offset1 : offset1 ? yearBefore(overview.openings.find((o) => o.offset === 1)?.endsOn ?? offset1) : '';
  const [designation, setDesignation] = useState(initial?.designation ?? defaultEndsOn.slice(0, 4));
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? defaultEndsOn);
  const [revenue, setRevenue] = useState(initial ? formatAmount(initial.revenueCents) : '');
  const [amount, setAmount] = useState(initial ? formatAmount(initial.amountCents) : '');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [amountErrors, setAmountErrors] = useState<Partial<Record<'revenue' | 'amount', AmountError>>>({});
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  // Beim Anlegen ist ein Beleg Pflicht; der gesperrte Knopf nennt, was fehlt (MUSTER § B, wie 125).
  const documentMissing = initial === null && !document && !file;

  const close = () => {
    feedback.reset();
    onOpenChange(false);
  };

  const submit = async () => {
    const read = readAmounts({ revenue: { text: revenue, required: true }, amount: { text: amount, required: true } });
    if (!read.ok) {
      setAmountErrors(read.errors);
      return;
    }
    setAmountErrors({});
    const form = new FormData();
    form.append('offset', String(offset));
    form.append('designation', designation.trim());
    form.append('endsOn', endsOn);
    form.append('revenueCents', String(read.cents.revenue));
    form.append('amountCents', String(read.cents.amount));
    if (initial) form.append('expectedVersion', initial.updatedAt);
    if (document) form.append('documentId', document.id);
    else if (file) form.append('file', file);
    setPending(true);
    const result = await feedback.run(() => saveFundsUseOpeningAction(form), { retry: () => void submit() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('saved'));
    close();
    router.refresh();
  };

  const amountError = (key: 'revenue' | 'amount', field: 'revenueCents' | 'amountCents') => (amountErrors[key] ? tAmount(amountErrors[key]) : fieldErrors[field]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent size="md" className="bg-surface shadow-md" finalFocus={finalFocus}>
        <DialogTitle>{initial ? t('editTitle') : t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        <div className="space-y-3.5" data-testid="funds-use-opening-dialog">
          <FormGrid>
            <FixedValue id="funds-use-opening-year" label={t('year')} value={offset === 1 ? t('offset1') : t('offset2')} reason={t('yearReason', { year: overview.firstFiscalYear?.designation ?? '' })} size="m" />
            <FormField id="funds-use-opening-designation" label={t('designation')} required size="s" error={fieldErrors.designation}>
              <Input id="funds-use-opening-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} aria-invalid={fieldErrors.designation ? true : undefined} />
            </FormField>
            <FormField id="funds-use-opening-ends-on" label={t('endsOn')} required size="s" error={fieldErrors.endsOn}>
              <Input id="funds-use-opening-ends-on" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-invalid={fieldErrors.endsOn ? true : undefined} />
            </FormField>
            <FormField id="funds-use-opening-revenue" label={t('revenue')} hint={t('revenueHint')} required size="s">
              <AmountField id="funds-use-opening-revenue" name="revenue" value={revenue} onChange={setRevenue} required invalid={!!amountError('revenue', 'revenueCents')} errorText={amountError('revenue', 'revenueCents')} />
            </FormField>
            <FormField id="funds-use-opening-amount" label={t('amount')} required size="s">
              <AmountField id="funds-use-opening-amount" name="amount" value={amount} onChange={setAmount} required invalid={!!amountError('amount', 'amountCents')} errorText={amountError('amount', 'amountCents')} />
            </FormField>
          </FormGrid>
          <ResolutionField id="funds-use-opening-document" label={t('document')} pickLabel={t('documentPick')} required={initial === null} document={document} onDocument={setDocument} onFile={setFile} />
          {initial ? <p className="text-hint text-muted-ink">{t('documentKept')}</p> : null}
        </div>
        <FormActionBar
          placement="dialog"
          cancel={close}
          pending={pending}
          saveDisabled={documentMissing}
          extraActions={documentMissing ? <span className="self-center text-meta text-ink-2">{t('documentMissing')}</span> : undefined}
          saveLabel={t('save')}
          onSave={() => void submit()}
          state={withUnplacedFieldErrors(feedback.state, PLACED)}
        />
      </DialogContent>
    </Dialog>
  );
}
