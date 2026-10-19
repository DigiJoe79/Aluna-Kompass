'use client';

import type { AdmissionPreview } from '@kompass/module-members';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatEuro } from '@/lib/finance/amount';
import { admitMemberAction, previewAdmissionAction } from '../actions';

const monthsOf = (start: string, end: string) => (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;

/**
 * Aufnehmen (Handoff Mitglieder 3b, Nachtrag Phase 2 § 0): Dialog `md` mit Datum, der nächsten Nummer, dem Beitrag des
 * Eintrittsjahres nach der Einstellung und der Aufnahmebestätigung. Ohne Anschrift und E-Mail sperrt nichts: ein
 * Hinweis `warn` mit dem Weg zum Kontakt, der Haken für die Bestätigung bleibt aus.
 */
export function AdmitDialog({ membershipId, name, today, finalFocus, onClose }: { membershipId: string; name: string; today: string; finalFocus?: React.RefObject<HTMLElement | null>; onClose: () => void }) {
  const t = useTranslations('members.admit');
  const { date } = useDateFormat();
  const router = useRouter();
  const [admittedOn, setAdmittedOn] = useState(today);
  const [preview, setPreview] = useState<AdmissionPreview | null>(null);
  const [createFees, setCreateFees] = useState(true);
  const [letter, setLetter] = useState(true);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(admittedOn)) return;
    let current = true;
    void previewAdmissionAction({ membershipId, admittedOn }).then((result) => {
      if (!current || result.status !== 'success') return;
      const next = result.data as AdmissionPreview;
      setPreview(next);
      if (!next.letterPossible) setLetter(false);
    });
    return () => {
      current = false;
    };
  }, [membershipId, admittedOn]);

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => admitMemberAction({ membershipId, admittedOn, createFees: createFees && (preview?.charges.length ?? 0) > 0, letter: letter && (preview?.letterPossible ?? false) }), { retry: () => void submit() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    const refused = (result.data as { letterRefused: string | null }).letterRefused;
    if (refused) toast.warning(refused, { duration: Infinity, closeButton: true });
    onClose();
    router.refresh();
  };

  const charges = preview?.charges ?? [];
  const sum = charges.reduce((s, c) => s + c.amountCents, 0);
  const feesText = !preview
    ? null
    : !preview.createsFees
      ? t('feesLater', { year: preview.year })
      : charges.length === 0
        ? t('noFees', { year: preview.year })
        : charges.length > 1
          ? t('createFeesMany', { year: preview.year, count: charges.length, amount: formatEuro(sum), due: date(charges[0]!.dueOn) })
          : preview.joinYearRule === 'proRataMonths' && charges[0]!.periodStart.slice(5) !== '01-01'
            ? t('createFeesProRata', { year: preview.year, amount: formatEuro(sum), months: monthsOf(charges[0]!.periodStart, charges[0]!.periodEnd), due: date(charges[0]!.dueOn) })
            : t('createFees', { year: preview.year, amount: formatEuro(sum), due: date(charges[0]!.dueOn) });

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('title', { name })}</DialogTitle>
          <DialogDescription>{t('text', { name })}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormGrid>
            <FormField id="admit-date" label={t('admittedOn')} required size="s">
              <Input id="admit-date" type="date" value={admittedOn} onChange={(e) => setAdmittedOn(e.target.value)} />
            </FormField>
            <FixedValue id="admit-number" label={t('number')} value={preview?.nextNumber ?? null} reason={t('numberReason')} testId="admit-number" />
            {preview && feesText && preview.createsFees && charges.length > 0 ? (
              <FormField id="admit-fees" label={feesText} hint={t('createFeesHint')} toggle size="full">
                <Checkbox id="admit-fees" checked={createFees} onCheckedChange={(on) => setCreateFees(on === true)} />
              </FormField>
            ) : feesText ? (
              <FormCell size="full" as="p" className="text-meta text-ink-2">{feesText}</FormCell>
            ) : null}
            <FormField id="admit-letter" label={t('letter')} toggle size="full">
              <Checkbox id="admit-letter" checked={letter} disabled={!preview?.letterPossible} onCheckedChange={(on) => setLetter(on === true)} />
            </FormField>
          </FormGrid>
          {preview && !preview.letterPossible ? (
            <Notice level="warn" action={<Link href={`/contacts/${preview.recipientContactId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('addAddress')}</Link>}>{t('noAddress')}</Notice>
          ) : null}
          {preview?.mandatePending ? <Notice level="hint">{t('mandatePending')}</Notice> : null}
          {/* R8: Ohne geltenden Stand oder Regel entstünde still kein Beitrag. */}
          {preview?.feeProblem ? <Notice level="warn" testId="admit-fee-problem">{t(preview.feeProblem === 'noSchedule' ? 'feeNoSchedule' : 'feeNoRule', { year: preview.year })}</Notice> : null}
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!admittedOn} saveLabel={t('submit')} onSave={() => void submit()} state={feedback.state} testId="admit-footer" />
      </DialogContent>
    </Dialog>
  );
}
