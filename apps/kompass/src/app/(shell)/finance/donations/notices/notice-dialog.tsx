'use client';

import type { NoticeView } from '@kompass/module-finance';
import { noticeSentence, usageSentence } from '@kompass/module-finance/wording';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { isIsoDay, paperDate } from '@/lib/dates';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { attachNoticeDocumentAction, saveNoticeAction, type NoticeInput } from './actions';

export type NoticeKind = NoticeInput['kind'];
const KINDS: NoticeKind[] = ['exemptionNotice', 'corporateTaxNoticeAttachment', 'section60a'];

/** Was der Dialog vom gespeicherten Bescheid braucht — für „Dokument nachreichen“ und die Auswahl aus der Akte. */
export type SavedNotice = Pick<NoticeView, 'id' | 'kind' | 'taxOffice' | 'taxNumber' | 'noticeDate' | 'exemptFrom' | 'assessmentPeriod' | 'purposesText' | 'purposesTextAccusative' | 'documentId' | 'documentNumber'>;

/**
 * „Bescheid erfassen“ (C3, F6a Task 8) in zwei Schritten: erst die Angaben
 * speichern, dann das Dokument nachreichen — als PDF (abgelegt in der Akte im
 * Namen des Bescheids, `attachNoticeDocument`) oder, wer die Akte sieht, aus
 * ihr gewählt. Beim § 60a-Bescheid fragt der Dialog, ob schon ein
 * Freistellungsbescheid erteilt wurde; dann gilt jener, und § 60a wird nicht
 * gespeichert. Mit `attachTo` öffnet er gleich im zweiten Schritt.
 */
export function NoticeDialog({ open, onOpenChange, canPickDocument, attachTo }: { open: boolean; onOpenChange: (open: boolean) => void; canPickDocument: boolean; attachTo?: SavedNotice }) {
  const t = useTranslations('finance.donations.notices.dialog');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* fixed-footer: das zweite Wortlaut-Feld und die Vorschau (N8) lassen den Dialog beim § 60a-Bescheid höher werden, als mancher Bildschirm hoch ist — die Mitte scrollt, Kopf und Leiste stehen. */}
      <DialogContent size="lg" layout="fixed-footer" className="bg-surface shadow-md">
        <DialogHeader>
          <DialogTitle>{attachTo ? t('documentTitle') : t('title')}</DialogTitle>
        </DialogHeader>
        {open ? <NoticeSteps key={attachTo?.id ?? 'new'} canPickDocument={canPickDocument} attachTo={attachTo} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NoticeSteps({ canPickDocument, attachTo, onClose }: { canPickDocument: boolean; attachTo?: SavedNotice; onClose: () => void }) {
  const [saved, setSaved] = useState<SavedNotice | null>(attachTo ?? null);
  return saved ? <DocumentStep notice={saved} canPickDocument={canPickDocument} onChanged={setSaved} onClose={onClose} /> : <FormStep onSaved={setSaved} onCancel={onClose} />;
}

function FormStep({ onSaved, onCancel }: { onSaved: (notice: SavedNotice) => void; onCancel: () => void }) {
  const t = useTranslations('finance.donations.notices.dialog');
  const tk = useTranslations('finance.donations.noticeKind');
  const router = useRouter();
  const [kind, setKind] = useState<NoticeKind>('exemptionNotice');
  const [taxOffice, setTaxOffice] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [noticeDate, setNoticeDate] = useState('');
  const [exemptFrom, setExemptFrom] = useState('');
  const [assessmentPeriod, setAssessmentPeriod] = useState('');
  const [purposesText, setPurposesText] = useState('');
  const [purposesTextAccusative, setPurposesTextAccusative] = useState('');
  const [hadExemption, setHadExemption] = useState<'yes' | 'no' | null>(null);
  const feedback = useActionFeedback();
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const [pending, setPending] = useState(false);

  const provisional = kind === 'section60a';
  const blockedByQuestion = provisional && hadExemption !== 'no';

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        saveNoticeAction({
          kind,
          taxOffice,
          taxNumber,
          noticeDate,
          exemptFrom: exemptFrom || undefined,
          assessmentPeriod: provisional ? null : assessmentPeriod || null,
          purposesText,
          purposesTextAccusative: provisional ? purposesTextAccusative : null,
        }),
      { retry: () => void submit() },
    );
    setPending(false);
    if (result.status === 'success') {
      router.refresh();
      onSaved(result.data as SavedNotice);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="notice-form">
      <DialogBody>
        <section>
          <h3 className="text-[15px] font-semibold">{t('sections.notice')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormField id="notice-kind" label={t('kind')} required>
                <Select id="notice-kind" value={kind} onChange={(e) => { setKind(e.target.value as NoticeKind); setHadExemption(null); feedback.reset(); }}>
                  {KINDS.map((k) => <option key={k} value={k}>{tk(k)}</option>)}
                </Select>
              </FormField>
              {provisional ? (
                <FormCell size="full" className="space-y-2 rounded-md border border-line bg-surface-2 p-3">
                  <p id="notice-question" className="text-[13px] font-semibold text-ink">{t('section60aQuestion')}</p>
                  <RadioGroup aria-labelledby="notice-question" value={hadExemption} onValueChange={(value) => setHadExemption(value as 'yes' | 'no')} className="flex-row gap-4 text-[13px]">
                    <label className="flex items-center gap-1.5"><RadioGroupItem value="yes" />{t('yes')}</label>
                    <label className="flex items-center gap-1.5"><RadioGroupItem value="no" />{t('no')}</label>
                  </RadioGroup>
                  {hadExemption === 'yes' ? (
                    <Notice level="warn" action={<Button type="button" variant="outline" size="sm" onClick={() => { setKind('exemptionNotice'); setHadExemption(null); }}>{t('switchToExemption')}</Button>}>
                      {t('section60aRefused')}
                    </Notice>
                  ) : null}
                </FormCell>
              ) : null}
            </FormGrid>
          </div>
        </section>

        <section className="mt-5 border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold">{t('sections.taxOffice')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormField id="notice-tax-office" label={t('taxOffice')} required error={fieldErrors.taxOffice}>
                <Input id="notice-tax-office" value={taxOffice} onChange={(e) => setTaxOffice(e.target.value)} />
              </FormField>
              <FormField id="notice-tax-number" label={t('taxNumber')} required error={fieldErrors.taxNumber} size="s">
                <Input id="notice-tax-number" className="font-mono" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
              </FormField>
            </FormGrid>
          </div>
        </section>

        <section className="mt-5 border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold">{t('sections.period')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormField id="notice-date" label={t('noticeDate')} required error={fieldErrors.noticeDate} size="s">
                <Input id="notice-date" type="date" className="font-mono" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
              </FormField>
              <FormField id="notice-exempt-from" label={t('exemptFrom')} required hint={t('exemptFromHint')} error={fieldErrors.exemptFrom} size="s">
                <Input id="notice-exempt-from" type="date" className="font-mono" value={exemptFrom} onChange={(e) => setExemptFrom(e.target.value)} />
              </FormField>
              {provisional ? null : (
                <FormField id="notice-period" label={t('assessmentPeriod')} required hint={t('assessmentPeriodHint')} error={fieldErrors.assessmentPeriod} size="s">
                  <Input id="notice-period" value={assessmentPeriod} onChange={(e) => setAssessmentPeriod(e.target.value)} />
                </FormField>
              )}
            </FormGrid>
          </div>
        </section>

        <section className="mt-5 border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold">{t('sections.purposes')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormField id="notice-purposes" label={t('purposesText')} required hint={t('purposesHint')} error={fieldErrors.purposesText} size="l">
                <Textarea id="notice-purposes" rows={3} value={purposesText} onChange={(e) => setPurposesText(e.target.value)} />
              </FormField>
              {provisional ? (
                <FormField id="notice-purposes-accusative" label={t('purposesTextAccusative')} required hint={t('purposesTextAccusativeHint')} error={fieldErrors.purposesTextAccusative} size="l">
                  <Textarea id="notice-purposes-accusative" rows={3} value={purposesTextAccusative} onChange={(e) => setPurposesTextAccusative(e.target.value)} />
                </FormField>
              ) : null}
              {purposesText.trim() ? (
                <FormCell size="full" className="space-y-1.5 rounded-md border border-line bg-surface-2 p-3 text-[13px]" data-testid="notice-purposes-preview">
                  <p className="font-semibold text-ink">{t('previewTitle')}</p>
                  <p className="text-ink-2">
                    {noticeSentence({
                      kind,
                      taxOffice: taxOffice || '…',
                      taxNumber: taxNumber || '…',
                      // Papierdatum wie im amtlichen Satz, unabhängig von ui.dateFormat (K10); halbe Eingaben zeigen „…“.
                      noticeDate: noticeDate && isIsoDay(noticeDate) ? paperDate(noticeDate) : '…',
                      assessmentPeriod: provisional ? null : assessmentPeriod || null,
                      purposesText,
                      purposesTextAccusative: provisional ? purposesTextAccusative || null : null,
                    })}
                  </p>
                  <p className="text-ink-2">{usageSentence(purposesText)}</p>
                </FormCell>
              ) : null}
            </FormGrid>
          </div>
        </section>
      </DialogBody>

      <FormActionBar placement="dialog" cancel={onCancel} pending={pending} saveDisabled={blockedByQuestion} saveLabel={t('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, ['taxOffice', 'taxNumber', 'noticeDate', 'exemptFrom', 'assessmentPeriod', 'purposesText', 'purposesTextAccusative'])} />
    </div>
  );
}

function DocumentStep({ notice, canPickDocument, onChanged, onClose }: { notice: SavedNotice; canPickDocument: boolean; onChanged: (notice: SavedNotice) => void; onClose: () => void }) {
  const t = useTranslations('finance.donations.notices.dialog');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<PickedDocument | null>(null);
  const feedback = useActionFeedback();

  const finish = (result: ActionState) => {
    setPending(false);
    if (result.status === 'success') {
      router.refresh();
      onChanged(result.data as SavedNotice);
    }
  };

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setPending(true);
    const formData = new FormData();
    formData.append('id', notice.id);
    formData.append('file', file);
    finish(await feedback.run(() => attachNoticeDocumentAction(formData), { retry: () => void upload(files) }));
  };

  const pick = async (doc: PickedDocument | null) => {
    setPicked(doc);
    if (!doc) return;
    setPending(true);
    const { id, kind, taxOffice, taxNumber, noticeDate, exemptFrom, assessmentPeriod, purposesText, purposesTextAccusative } = notice;
    finish(await feedback.run(() => saveNoticeAction({ id, kind, taxOffice, taxNumber, noticeDate, exemptFrom, assessmentPeriod, purposesText, purposesTextAccusative, documentId: doc.id })));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="notice-document-step">
      <DialogBody className="space-y-4">
        {notice.documentId ? (
          <p className="text-[14px] text-ink" data-testid="notice-document-number">
            <span className="font-mono font-semibold">{notice.documentNumber}</span>
          </p>
        ) : (
          <>
            <p className="text-[13px] text-ink-2">{t('documentHint')}</p>
            <RefusalNotice action state={feedback.state} />
            <ReceiptDrop onFiles={(files) => void upload(files)} disabled={pending} />
            {canPickDocument ? (
              <FormGrid>
                <FormCell size="m">
                  <DocumentPicker id="notice-document-pick" name="documentId" label={t('pickFromArchive')} value={picked} onChange={(doc) => void pick(doc)} />
                </FormCell>
              </FormGrid>
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" onClick={onClose}>{t('done')}</Button>
      </DialogFooter>
    </div>
  );
}
