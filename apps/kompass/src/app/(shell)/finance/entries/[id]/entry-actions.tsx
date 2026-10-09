'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { RecordActions } from '@/components/record-actions';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { reverseEntryAction } from '../actions';

/**
 * Seltene Aktionen an einer festgeschriebenen Buchung (MUSTER § C, Board § K Ziel 5): „Zurücknehmen …“ im Menü ⋯ —
 * das Board sagt „Stornieren“, die Finanzen sprechen aber „zurücknehmen“ (Verbotsliste `finance-wording.test.ts`).
 * „Korrigieren“ bleibt der sichtbare nächste Schritt und bucht nur noch um.
 *
 * Die Nummer der Gegenbuchung vergibt erst das Festschreiben im Dienst — die Seite kennt sie vorab nicht, deshalb nennt
 * der Dialog nur das Datum (Designer 2026-10-08) und der Toast danach Nummer und Link. Das Datum rechnet die Seite wie
 * der Dienst: im offenen Geschäftsjahr das Datum der Buchung, sonst heute.
 *
 * Bereits zurückgenommen: kein Eintrag — der Verweis „zurückgenommen durch …“ steht dauerhaft auf der Seite. Ist die
 * Buchung selbst eine Rücknahme, bleibt der Eintrag und der Dialog nennt den Grund (keine Sperre ohne Grund).
 */
/**
 * Öffnet „Zurücknehmen …“ von anderer Stelle aus — der Korrekturdialog verweist für Betrag, Datum, Konto und Steuer
 * dorthin (Joe 2026-10-08: Satz mit Link statt der früheren Weiche „Was ist falsch?“). `null` außerhalb von `EntryActions`.
 */
const OpenReverseContext = createContext<(() => void) | null>(null);
export const useOpenReverse = () => useContext(OpenReverseContext);

export function EntryActions({ entry, reversalDate, children }: { entry: { id: string; number: string | null; isReversal: boolean; reversed: boolean }; reversalDate: string; children?: ReactNode }) {
  const t = useTranslations('finance.entryView.reverse');
  const tErrors = useTranslations('finance.errors');
  const fmt = useDateFormat();
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [withCorrectionDraft, setWithCorrectionDraft] = useState(true);
  const [cashReason, setCashReason] = useState<string | null>(null);
  const [cashReasonText, setCashReasonText] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const number = entry.number ?? entry.id;

  const close = () => {
    setOpen(false);
    setCashReason(null);
    setCashReasonText('');
    feedback.reset();
  };

  const submit = async () => {
    setPending(true);
    const reason = cashReason ? cashReasonText : undefined;
    const result = await feedback.run(() => reverseEntryAction(entry.id, withCorrectionDraft, reason), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'error') {
      // Die Kasse ginge ins Minus: Der Dienst fragt nach einer Begründung, der Dialog bleibt offen.
      if (result.code === 'cashNegativeNeedsReason') {
        feedback.reset();
        setCashReason(result.detail ?? result.message);
      }
      return;
    }
    if (result.status !== 'success') return;
    close();
    const data = result.data as { reversal: { id: string; number: string | null }; correctionDraft: { id: string } | null };
    toast.success(t('done', { number: data.reversal.number ?? '' }), { action: { label: t('open'), onClick: () => router.push(`/finance/entries/${data.reversal.id}`) } });
    if (data.correctionDraft) router.push(`/finance/entries/${data.correctionDraft.id}/edit`);
    else router.refresh();
  };

  return (
    <OpenReverseContext.Provider value={entry.reversed ? null : () => setOpen(true)}>
      {/* „Korrigieren“ (sichtbarer nächster Schritt) steht vor dem Menü ⋯ und kann „Zurücknehmen …“ öffnen. */}
      {children}
      <RecordActions triggerRef={trigger} actions={[{ key: 'reverse', label: t('item'), kind: 'undoing', onSelect: () => setOpen(true), hidden: entry.reversed, testId: 'entry-reverse-trigger' }]} />
      {entry.isReversal ? (
        <ConfirmDialog
          open={open}
          onOpenChange={(next) => (next ? setOpen(true) : close())}
          finalFocus={trigger}
          title={t('title', { number })}
          description={t('description', { date: fmt.date(reversalDate) })}
          confirmLabel={t('submit')}
          destructive
          refusal={{ message: `${tErrors('entryIsReversal.reason', { number })} ${tErrors('entryIsReversal.remedy')}` }}
          action={async () => ({ status: 'idle' })}
        />
      ) : (
        <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
          <DialogContent role="alertdialog" size="sm" className="bg-surface shadow-md" finalFocus={trigger}>
            <DialogTitle>{t('title', { number })}</DialogTitle>
            <DialogDescription tone="body">{t('description', { date: fmt.date(reversalDate) })}</DialogDescription>
            <FormGrid>
              <FormField id="reverse-with-draft" label={t('withDraft')} toggle size="full">
                <Switch id="reverse-with-draft" checked={withCorrectionDraft} onCheckedChange={(c) => setWithCorrectionDraft(c === true)} />
              </FormField>
            </FormGrid>
            {cashReason ? (
              <Notice level="warn" reason={{ name: 'cashReason', value: cashReasonText, onChange: setCashReasonText, label: t('cashReasonLabel') }}>
                {cashReason}
              </Notice>
            ) : null}
            <FormActionBar
              placement="dialog"
              mode="run"
              cancel={close}
              destructive
              pending={pending}
              saveLabel={t('submit')}
              saveDisabled={cashReason !== null && cashReasonText.trim().length === 0}
              onSave={() => void submit()}
              state={feedback.state}
            />
          </DialogContent>
        </Dialog>
      )}
    </OpenReverseContext.Provider>
  );
}
