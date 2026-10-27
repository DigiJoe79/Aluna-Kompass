'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { ConsequenceList } from '@/components/consequence-list';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { reopenYearAction } from './actions';

export interface ReopenPreview {
  consequences: { code: string; params: Record<string, string | number> }[];
  laterYearClosed: boolean;
  /** Das spätere Jahr, das zuerst wieder zu öffnen ist (Designer Runde 8, 17f). */
  laterYear?: { id: string; designation: string } | null;
  /** Schon als Text für den Bildschirm. */
  taxReturnFiledOn: string | null;
  /** Der Erklärungszeitraum der Abgabe („2023–2025“), Befund 34 b. */
  taxReturnPeriod: string | null;
  /** N14: abgegebene Umsatzsteuer-Erklärungen der Zeiträume des Jahres, Zeitraum und Tag schon als Text. */
  vatFiled?: { kind: 'annual' | 'advance'; period: string; date: string }[];
}

/**
 * „<Jahr> wiederöffnen“ (Dialog `md`): die Folgen aus `previewPeriodReopen` als `ConsequenceList`, „Begründung*“,
 * „Wiederöffnen“. Ist ein späteres Jahr abgeschlossen, nennt der Dialog den Grund (keine Sperre ohne Grund).
 */
export function ReopenDialog({ open, onOpenChange, fiscalYearId, year, preview, finalFocus }: { open: boolean; onOpenChange: (open: boolean) => void; fiscalYearId: string; year: string; preview: ReopenPreview; finalFocus?: RefObject<HTMLElement | null> }) {
  const t = useTranslations('finance.closing.reopenDialog');
  const tc = useTranslations('finance.reopenConsequences');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setNote('');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const items = preview.consequences.map((c) => ({ label: tc.has(c.code) ? tc(c.code, c.params) : c.code, count: typeof c.params.count === 'number' ? c.params.count : undefined }));
  const vatFiled = preview.vatFiled ?? [];
  const vatAdvance = vatFiled.filter((v) => v.kind === 'advance');
  const allItems = [
    ...items,
    ...(preview.taxReturnFiledOn ? [{ label: t('taxFiled', { period: preview.taxReturnPeriod ?? year, date: preview.taxReturnFiledOn }) }] : []),
    ...vatFiled.filter((v) => v.kind === 'annual').map((v) => ({ label: t('vatReturnFiled', { period: v.period, date: v.date }) })),
    ...(vatAdvance.length > 0 ? [{ label: t('vatAdvanceFiled', { periods: vatAdvance.map((v) => t('vatAdvanceFiledPeriod', { period: v.period, date: v.date })).join(', ') }) }] : []),
  ];

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => reopenYearAction(fiscalYearId, note), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('done', { year }));
    onOpenChange(false);
    router.refresh();
  };

  // Designer Runde 8, 17f: Steht die Ablehnung vorher fest, fragt der Dialog nichts ab — kein Begründungsfeld, keine
  // Folgenliste, kein primärer Knopf. Nur der Satz, der Weg zum späteren Jahr und „Schließen“.
  if (preview.laterYearClosed) {
    const later = preview.laterYear ?? null;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" finalFocus={finalFocus} showCloseButton={false} data-testid="closing-reopen-dialog">
          <DialogHeader>
            <DialogTitle>{t('title', { year })}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              <Notice level="refuse">{later ? t('laterYearClosedNamed', { later: later.designation }) : t('laterYearClosed')}</Notice>
              {later ? (
                <Link href={`/finance/closing?year=${encodeURIComponent(later.id)}`} className="text-link underline-offset-2 hover:underline" onClick={() => onOpenChange(false)} data-testid="closing-reopen-later">
                  {t('toLaterYear', { later: later.designation })}
                </Link>
              ) : null}
            </div>
          </DialogBody>
          {/* Ohne Hauptaktion: nur „Schließen“ (MUSTER § B, wie `ConfirmDialog refusal`). */}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} autoFocus>
              {tCommon('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" finalFocus={finalFocus} data-testid="closing-reopen-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { year })}</DialogTitle>
          <DialogDescription tone="body">{t('description', { year })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            {allItems.length > 0 ? (
              <div className="flex flex-col gap-1.5" data-testid="closing-reopen-consequences">
                <Overline field>{t('consequences')}</Overline>
                <ConsequenceList items={allItems} />
              </div>
            ) : null}
            <FormField id="closing-reopen-note" label={t('note')} hint={t('noteHint')} required error={fieldErrors.note} size="full">
              <Textarea id="closing-reopen-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </FormField>
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={t('save')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['note'])}
          testId="closing-reopen-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
