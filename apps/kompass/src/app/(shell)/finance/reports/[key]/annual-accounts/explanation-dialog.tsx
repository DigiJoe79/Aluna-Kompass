'use client';

import { ANNUAL_ACCOUNTS_EXPLANATION_MAX } from '@kompass/module-finance/codes';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { MarkdownPreview } from '@/components/markdown-preview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveAnnualAccountsExplanationAction } from './actions';

/**
 * „Erläuterung {Jahr}“ (Designer Frage 1): `edit` mit Textfeld (Markdown wie die übrigen Textfelder) und Zähler
 * „n von 4.000 Zeichen“, gespeichert mit dem Stand beim Öffnen — ein zweiter Tab bekommt den Konfliktsatz mit „Neuen
 * Stand laden“ (Leiste). `view` nach dem Festschreiben: der Text gerendert, nur „Schließen“ (kein Hauptschritt, daher
 * `DialogFooter` statt Leiste).
 */
export function ExplanationDialog({
  open,
  onOpenChange,
  fiscalYearId,
  designation,
  text,
  updatedAt,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscalYearId: string;
  designation: string;
  text: string;
  updatedAt: string | null;
  mode: 'edit' | 'view';
}) {
  const t = useTranslations('finance.reports.annualAccounts.explanation');
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setValue(text);
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => saveAnnualAccountsExplanationAction({ fiscalYearId, text: value, expectedVersion: updatedAt }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="annual-accounts-explanation-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { year: designation })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {mode === 'edit' ? (
            <FormField id="annual-accounts-explanation" label={t('label')} hint={t('counter', { count: value.length, max: ANNUAL_ACCOUNTS_EXPLANATION_MAX })} error={fieldErrors.text} size="full">
              <Textarea id="annual-accounts-explanation" value={value} onChange={(e) => setValue(e.target.value)} rows={12} />
            </FormField>
          ) : (
            <MarkdownPreview markdown={text} />
          )}
        </DialogBody>
        {mode === 'edit' ? (
          <FormActionBar placement="dialog" cancel={() => onOpenChange(false)} onSave={() => void save()} pending={pending} count={value === text ? 0 : 1} state={withUnplacedFieldErrors(feedback.state, ['text'])} />
        ) : (
          // Nur Lesen: kein Hauptschritt, deshalb Fuß ohne Leiste (MUSTER § B).
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('close')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
