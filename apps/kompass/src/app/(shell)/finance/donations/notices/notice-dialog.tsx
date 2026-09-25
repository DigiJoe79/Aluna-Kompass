'use client';

import type { NoticeView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { attachNoticeDocumentAction, saveNoticeAction, type NoticeInput } from './actions';

export type NoticeKind = NoticeInput['kind'];
const KINDS: NoticeKind[] = ['exemptionNotice', 'corporateTaxNoticeAttachment', 'section60a'];

/** Was der Dialog vom gespeicherten Bescheid braucht — für „Dokument nachreichen“ und die Auswahl aus der Akte. */
export type SavedNotice = Pick<NoticeView, 'id' | 'kind' | 'taxOffice' | 'taxNumber' | 'noticeDate' | 'exemptFrom' | 'assessmentPeriod' | 'purposesText' | 'documentId' | 'documentNumber'>;

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
      <DialogContent className="bg-surface shadow-md sm:max-w-[620px]">
        <DialogTitle className="font-heading text-[19px]">{attachTo ? t('documentTitle') : t('title')}</DialogTitle>
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
  const [hadExemption, setHadExemption] = useState<'yes' | 'no' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const provisional = kind === 'section60a';
  const blockedByQuestion = provisional && hadExemption !== 'no';

  const submit = async () => {
    setPending(true);
    const result = await saveNoticeAction({ kind, taxOffice, taxNumber, noticeDate, exemptFrom: exemptFrom || undefined, assessmentPeriod: provisional ? null : assessmentPeriod || null, purposesText });
    setPending(false);
    if (result.status === 'error') {
      setFieldErrors(result.fieldErrors);
      setRefusal(result.code ? result.message : null);
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      router.refresh();
      onSaved(result.data as SavedNotice);
    }
  };

  const field = (id: string, label: string, node: React.ReactNode, hint?: string, error?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} required>{label}</Label>
      {node}
      {hint ? <p className="text-[12px] text-muted-ink">{hint}</p> : null}
      {error ? <p className="text-[12px] text-error" data-testid={`${id}-error`}>{error}</p> : null}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="notice-form">
      {field(
        'notice-kind',
        t('kind'),
        <Select id="notice-kind" value={kind} onChange={(e) => { setKind(e.target.value as NoticeKind); setHadExemption(null); setRefusal(null); }}>
          {KINDS.map((k) => <option key={k} value={k}>{tk(k)}</option>)}
        </Select>,
      )}

      {provisional ? (
        <div role="radiogroup" aria-labelledby="notice-question" className="space-y-2 rounded-md border border-line bg-surface-2 p-3">
          <p id="notice-question" className="text-[13px] font-semibold text-ink">{t('section60aQuestion')}</p>
          <div className="flex gap-4 text-[13px]">
            <label className="flex items-center gap-1.5"><input type="radio" name="notice-had-exemption" checked={hadExemption === 'yes'} onChange={() => setHadExemption('yes')} />{t('yes')}</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="notice-had-exemption" checked={hadExemption === 'no'} onChange={() => setHadExemption('no')} />{t('no')}</label>
          </div>
          {hadExemption === 'yes' ? (
            <Notice level="warn" action={<Button type="button" variant="outline" size="sm" onClick={() => { setKind('exemptionNotice'); setHadExemption(null); }}>{t('switchToExemption')}</Button>}>
              {t('section60aRefused')}
            </Notice>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('notice-tax-office', t('taxOffice'), <Input id="notice-tax-office" value={taxOffice} onChange={(e) => setTaxOffice(e.target.value)} />, undefined, fieldErrors.taxOffice)}
        {field('notice-tax-number', t('taxNumber'), <Input id="notice-tax-number" className="font-mono" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />, undefined, fieldErrors.taxNumber)}
        {field('notice-date', t('noticeDate'), <Input id="notice-date" type="date" className="font-mono" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />, undefined, fieldErrors.noticeDate)}
        {field('notice-exempt-from', t('exemptFrom'), <Input id="notice-exempt-from" type="date" className="font-mono" value={exemptFrom} onChange={(e) => setExemptFrom(e.target.value)} />, t('exemptFromHint'), fieldErrors.exemptFrom)}
        {provisional ? null : field('notice-period', t('assessmentPeriod'), <Input id="notice-period" value={assessmentPeriod} onChange={(e) => setAssessmentPeriod(e.target.value)} />, t('assessmentPeriodHint'), fieldErrors.assessmentPeriod)}
      </div>
      {field('notice-purposes', t('purposesText'), <Textarea id="notice-purposes" rows={3} value={purposesText} onChange={(e) => setPurposesText(e.target.value)} />, t('purposesHint'), fieldErrors.purposesText)}

      {refusal ? <Notice level="refuse">{refusal}</Notice> : null}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="button" disabled={pending || blockedByQuestion} onClick={() => void submit()}>{t('save')}</Button>
      </DialogFooter>
    </div>
  );
}

function DocumentStep({ notice, canPickDocument, onChanged, onClose }: { notice: SavedNotice; canPickDocument: boolean; onChanged: (notice: SavedNotice) => void; onClose: () => void }) {
  const t = useTranslations('finance.donations.notices.dialog');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<PickedDocument | null>(null);

  const finish = (result: Awaited<ReturnType<typeof attachNoticeDocumentAction>>) => {
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      router.refresh();
      onChanged(result.data as SavedNotice);
    }
  };

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setPending(true);
    finish(await attachNoticeDocumentAction(notice.id, new Uint8Array(await file.arrayBuffer())));
  };

  const pick = async (doc: PickedDocument | null) => {
    setPicked(doc);
    if (!doc) return;
    setPending(true);
    const { id, kind, taxOffice, taxNumber, noticeDate, exemptFrom, assessmentPeriod, purposesText } = notice;
    finish(await saveNoticeAction({ id, kind, taxOffice, taxNumber, noticeDate, exemptFrom, assessmentPeriod, purposesText, documentId: doc.id }));
  };

  return (
    <div className="space-y-4" data-testid="notice-document-step">
      {notice.documentId ? (
        <p className="text-[14px] text-ink" data-testid="notice-document-number">
          <span className="font-mono font-semibold">{notice.documentNumber}</span>
        </p>
      ) : (
        <>
          <p className="text-[13px] text-ink-2">{t('documentHint')}</p>
          <ReceiptDrop onFiles={(files) => void upload(files)} disabled={pending} />
          {canPickDocument ? <DocumentPicker id="notice-document-pick" name="documentId" label={t('pickFromArchive')} value={picked} onChange={(doc) => void pick(doc)} /> : null}
        </>
      )}
      <DialogFooter>
        <Button type="button" onClick={onClose}>{t('done')}</Button>
      </DialogFooter>
    </div>
  );
}
