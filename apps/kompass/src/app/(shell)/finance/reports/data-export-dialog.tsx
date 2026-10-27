'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type RefObject } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { startDataExportAction } from './actions';

export interface DataExportYear {
  id: string;
  designation: string;
  closed: boolean;
}

/** Vorgabe (Board 13f): alle abgeschlossenen Jahre angehakt, offene nicht. */
export const defaultExportYears = (years: readonly DataExportYear[]): string[] => years.filter((y) => y.closed).map((y) => y.id);

/**
 * „Datenexport erzeugen“ (Board 13f, Dialog `md`): je Geschäftsjahr ein Haken, neuestes zuerst, mit Zustand; ein offenes
 * Jahr heißt „vorläufig“. „Erzeugen“ ist nie gesperrt — ohne Jahr nennt der Dienst den Fehler am Feld.
 */
export function DataExportDialog({
  open,
  onOpenChange,
  years,
  onStarted,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Neuestes zuerst. */
  years: readonly DataExportYear[];
  onStarted: () => void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('finance.reports.dataExport.dialog');
  const [chosen, setChosen] = useState<string[]>(() => defaultExportYears(years));
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  // Jedes Öffnen beginnt bei der Vorgabe.
  useEffect(() => {
    if (!open) return;
    setChosen(defaultExportYears(years));
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const toggle = (id: string, on: boolean) => setChosen((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => startDataExportAction(chosen), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    onStarted();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" finalFocus={finalFocus} data-testid="data-export-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {/* Bild 271, Board 13f: eine Kästchenliste wie „Im Beisein von“ im Zähldialog — Kästchen links, das Jahr als
              Label, der Zustand gedämpft dahinter. */}
          <div role="group" aria-labelledby="data-export-years-label" aria-describedby={fieldErrors.fiscalYearIds ? 'data-export-years-error' : undefined} className="flex flex-col gap-2">
            <Label id="data-export-years-label" required>
              {t('years')}
            </Label>
            {years.map((y) => (
              <span key={y.id} className="flex items-center gap-2">
                <Checkbox id={`data-export-year-${y.id}`} checked={chosen.includes(y.id)} onCheckedChange={(on) => toggle(y.id, on)} aria-describedby={`data-export-year-${y.id}-state`} />
                <Label htmlFor={`data-export-year-${y.id}`} className="font-normal">
                  {y.designation}
                </Label>
                <span id={`data-export-year-${y.id}-state`} className="text-meta text-muted-ink">
                  · {y.closed ? t('closed') : t('open')}
                </span>
              </span>
            ))}
            <FieldError id="data-export-years-error" message={fieldErrors.fiscalYearIds} />
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={t('save')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['fiscalYearIds'])}
          testId="data-export-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
