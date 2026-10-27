'use client';

import type { TaxPeriodView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type RefObject } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FixedValue } from '@/components/fixed-value';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { fileTaxPeriodDocumentAction, linkTaxPeriodDocumentAction, saveTaxPeriodAction } from './actions';
import type { DueSuggestions, TaxYear } from './types';

/**
 * „Erklärungszeitraum anlegen“ bzw. „Zeitraum bearbeiten …“ (Board 13g, Dialog `md`): Von und Bis (Pflicht, Geschäftsjahre),
 * Angefordert am, Aufforderung (aus der Akte oder hochladen → Platz `request`), „Mit Steuerberatung“, Frist* — vorbelegt
 * aus dem Vorschlag, solange niemand sie ändert. Von und Bis stehen fest, sobald eine Fassung festgeschrieben ist.
 * Überschneidung und Lücke nennt der Dienst am Feld. Abgabe, Dateien und Bescheid stehen nur im Abschnitt „Abgabe“.
 */
export function TaxPeriodDialog({
  open,
  onOpenChange,
  period,
  years,
  defaults,
  latestPeriod = null,
  dueSuggestions,
  canPickDocument,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bearbeiten; ohne: anlegen. */
  period: Pick<TaxPeriodView, 'id' | 'firstFiscalYearId' | 'lastFiscalYearId' | 'requestedOn' | 'withTaxAdvisor' | 'dueOn' | 'yearsLocked' | 'label' | 'version' | 'documents'> | null;
  /** Alle Geschäftsjahre, ältestes zuerst. */
  years: readonly TaxYear[];
  defaults: { firstFiscalYearId: string; lastFiscalYearId: string } | null;
  /** Bezeichnung des jüngsten Zeitraums: Ohne Vorschlag gibt es nach ihm kein Geschäftsjahr — Von und Bis bleiben leer (Befund 23d). */
  latestPeriod?: string | null;
  dueSuggestions: DueSuggestions;
  canPickDocument: boolean;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('finance.tax.periodDialog');
  const router = useRouter();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [requestedOn, setRequestedOn] = useState('');
  const [advisor, setAdvisor] = useState<'yes' | 'no'>('no');
  const [dueOn, setDueOn] = useState('');
  const [dueTouched, setDueTouched] = useState(false);
  const [request, setRequest] = useState<PickedDocument | null>(null);
  const [requestFile, setRequestFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const noYears = !period && !defaults && latestPeriod !== null;
  const suggestion = (lastId: string, withAdvisor: boolean) => {
    const s = dueSuggestions[lastId];
    return s ? (withAdvisor ? s.advisor : s.plain) : '';
  };

  useEffect(() => {
    if (!open) return;
    // Ohne Vorschlag nach einem Zeitraum kein Rückfall auf das jüngste Jahr: Es steht schon in einem Zeitraum (Befund 23d).
    const fallback = noYears ? '' : (years.at(-1)?.id ?? '');
    const firstId = period?.firstFiscalYearId ?? defaults?.firstFiscalYearId ?? fallback;
    const lastId = period?.lastFiscalYearId ?? defaults?.lastFiscalYearId ?? fallback;
    setFirst(firstId);
    setLast(lastId);
    setRequestedOn(period?.requestedOn ?? '');
    setAdvisor(period?.withTaxAdvisor ? 'yes' : 'no');
    setDueOn(period?.dueOn ?? suggestion(lastId, false));
    setDueTouched(Boolean(period));
    setRequest(null);
    setRequestFile(null);
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changeLast = (id: string) => {
    setLast(id);
    if (!dueTouched) setDueOn(suggestion(id, advisor === 'yes'));
  };
  const changeAdvisor = (value: 'yes' | 'no') => {
    setAdvisor(value);
    if (!dueTouched) setDueOn(suggestion(last, value === 'yes'));
  };

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const locked = period?.yearsLocked === true;
    const result = await feedback.run(
      () =>
        saveTaxPeriodAction({
          ...(period ? { id: period.id, expectedVersion: period.version } : {}),
          ...(locked ? {} : { firstFiscalYearId: first, lastFiscalYearId: last }),
          requestedOn: requestedOn || null,
          withTaxAdvisor: advisor === 'yes',
          ...(dueOn ? { dueOn } : {}),
        }),
      { retry: () => void save() },
    );
    if (result.status === 'success') {
      const id = period?.id ?? (result.data as { id: string }).id;
      // Die Aufforderung geht nach dem Speichern auf ihren Platz; scheitert das, bleibt der Dialog offen und nennt es.
      if (requestFile) {
        const formData = new FormData();
        formData.append('id', id);
        formData.append('slot', 'request');
        formData.append('file', requestFile);
        const filed = await feedback.run(() => fileTaxPeriodDocumentAction(formData));
        if (filed.status !== 'success') return finish(false);
      } else if (request) {
        const linked = await feedback.run(() => linkTaxPeriodDocumentAction({ id, slot: 'request', documentId: request.id }));
        if (linked.status !== 'success') return finish(false);
      }
      // Den Erfolg sagt schon `feedback.run` an (ein zweiter Toast stapelte sich, Designer Runde 7, 255).
      return finish(true);
    }
    finish(false);
  };
  const finish = (done: boolean) => {
    setPending(false);
    if (!done) return;
    onOpenChange(false);
    router.refresh();
  };

  const designation = (id: string) => years.find((y) => y.id === id)?.designation ?? '';
  const yearSelect = (id: string, label: string, value: string, onChange: (v: string) => void, error?: string) => (
    <FormField id={id} label={label} required error={error} size="s">
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {value === '' ? (
          <option value="" disabled>
            {t('choose')}
          </option>
        ) : null}
        {[...years].reverse().map((y) => (
          <option key={y.id} value={y.id}>
            {y.designation}
          </option>
        ))}
      </Select>
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" finalFocus={finalFocus} data-testid="tax-period-dialog">
        <DialogHeader>
          <DialogTitle>{period ? t('editTitle', { period: period.label }) : t('createTitle')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            {period?.yearsLocked ? (
              <>
                <FixedValue id="tax-period-first" label={t('first')} value={designation(period.firstFiscalYearId)} reason={t('yearsLocked')} size="s" />
                <FixedValue id="tax-period-last" label={t('last')} value={designation(period.lastFiscalYearId)} reason={t('yearsLocked')} size="s" />
              </>
            ) : (
              <>
                {yearSelect('tax-period-first', t('first'), first, setFirst, errors.firstFiscalYearId)}
                {yearSelect('tax-period-last', t('last'), last, changeLast, errors.lastFiscalYearId)}
                <FormCell size="full" as="p" className="text-hint text-muted-ink" data-testid={noYears ? 'tax-period-no-years' : undefined}>
                  {noYears ? t('noYears', { period: latestPeriod ?? '' }) : t('yearsHint')}
                </FormCell>
              </>
            )}
            <FormField id="tax-period-requested" label={t('requestedOn')} error={errors.requestedOn} size="s">
              <Input id="tax-period-requested" type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
            </FormField>
            <FormCell size="full" className="flex flex-col gap-2">
              {period?.documents.request ? (
                <p className="text-meta text-ink-2">{t('requestFiled', { number: period.documents.request.documentNumber })}</p>
              ) : null}
              {canPickDocument ? <DocumentPicker id="tax-period-request" name="requestDocumentId" label={t('request')} value={request} onChange={(d) => { setRequest(d); setRequestFile(null); }} /> : null}
              <ReceiptDrop onFiles={(files) => { setRequestFile(files[0] ?? null); setRequest(null); }} disabled={pending} />
              <p className="text-hint text-muted-ink">{requestFile ? t('requestFile', { name: requestFile.name }) : t('requestHint')}</p>
            </FormCell>
            <FormField id="tax-period-advisor" label={t('advisor')} size="m">
              <Segmented
                className="self-start"
                aria-label={t('advisor')}
                value={advisor}
                onValueChange={changeAdvisor}
                options={[
                  { value: 'yes', label: t('yes') },
                  { value: 'no', label: t('no') },
                ]}
              />
            </FormField>
            <FormField id="tax-period-due" label={t('dueOn')} required error={errors.dueOn} size="s">
              <Input id="tax-period-due" type="date" aria-describedby="tax-period-due-hint" value={dueOn} onChange={(e) => { setDueOn(e.target.value); setDueTouched(true); }} />
            </FormField>
            <FormCell size="full" as="p" className="text-hint text-muted-ink">
              <span id="tax-period-due-hint">{t('dueHint')}</span>
            </FormCell>
          </FormGrid>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode={period ? 'run' : 'create'}
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={period ? t('save') : t('create')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, period?.yearsLocked ? ['requestedOn', 'dueOn'] : ['firstFiscalYearId', 'lastFiscalYearId', 'requestedOn', 'dueOn'])}
          testId="tax-period-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
