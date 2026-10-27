'use client';

import { statementCoversYearEnd } from '@kompass/module-finance/statement-rules';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { FixedValue } from '@/components/fixed-value';
import { Overline } from '@/components/overline';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatEuro } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { fileStatementAction, linkStatementAction, suggestStatementAction } from './actions';

export interface StatementAccount {
  accountId: string;
  name: string;
  lastMovementOn: string | null;
  balanceAtYearEndCents: number;
}

/**
 * „Auszug für <Konto> ablegen“ (Board 13c, Dialog `md`): das Konto fest, Datei* (hochladen oder aus der Akte), Von und
 * Bis*. Nach der Wahl liest Kompass „Bis“ (und „Von“) aus dem PDF als Vorschlag (MUSTER § E). Ein Satz sagt, ob der
 * Auszug den Stichtag abdeckt — derselbe Maßstab wie der Dienst (`statementCoversYearEnd`). Genutzt von Schritt 1
 * und der Detailseite eines Berichts.
 */
export function StatementDialog({ open, onOpenChange, fiscalYearId, endsOn, account }: { open: boolean; onOpenChange: (open: boolean) => void; fiscalYearId: string; endsOn: string; account: StatementAccount }) {
  const t = useTranslations('finance.closing.statements.fileDialog');
  const fmt = useDateFormat();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [suggested, setSuggested] = useState<{ from: boolean; to: boolean }>({ from: false, to: false });
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setDocument(null);
    setFrom('');
    setTo('');
    setSuggested({ from: false, to: false });
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account.accountId]);

  const suggest = async (source: { file: File } | { documentId: string }) => {
    const formData = new FormData();
    formData.append('fiscalYearId', fiscalYearId);
    formData.append('accountId', account.accountId);
    if ('file' in source) formData.append('file', source.file);
    else formData.append('documentId', source.documentId);
    const found = await suggestStatementAction(formData).catch(() => null);
    if (!found) return;
    setTo((v) => (v ? v : found.periodTo));
    setFrom((v) => (v || !found.periodFrom ? v : found.periodFrom));
    setSuggested({ from: Boolean(found.periodFrom), to: true });
  };

  const pickFile = (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    setFile(picked);
    setDocument(null);
    void suggest({ file: picked });
  };
  const pickDocument = (doc: PickedDocument | null) => {
    setDocument(doc);
    setFile(null);
    if (doc) void suggest({ documentId: doc.id });
  };

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const covers = to ? statementCoversYearEnd(to, endsOn, account.lastMovementOn) : null;

  const save = async () => {
    setPending(true);
    const run = () => {
      if (document) return linkStatementAction(account.accountId, document.id, from || null, to);
      const formData = new FormData();
      formData.append('accountId', account.accountId);
      formData.append('periodFrom', from);
      formData.append('periodTo', to);
      if (file) formData.append('file', file);
      return fileStatementAction(formData);
    };
    const result = await feedback.run(run, { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('done', { number: (result.data as { documentNumber: string }).documentNumber }));
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="closing-statement-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { account: account.name })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FixedValue id="closing-statement-account" label={t('account')} value={account.name} reason={t('accountReason')} size="full" />
            <FormCell size="full" className="flex flex-col gap-2">
              <Overline field>
                {t('file')}
                <span aria-hidden> *</span>
              </Overline>
              <ReceiptDrop onFiles={pickFile} disabled={pending} />
              {file ? (
                <p className="text-hint text-muted-ink" data-testid="closing-statement-file">
                  {t('chosen', { name: file.name })}
                </p>
              ) : null}
              <DocumentPicker id="closing-statement-document" name="documentId" label={t('fromArchive')} value={document} onChange={pickDocument} />
              <FieldError id="closing-statement-bytes-error" message={fieldErrors.bytes ?? fieldErrors.documentId} />
            </FormCell>
            <FormField id="closing-statement-from" label={t('from')} hint={suggested.from ? t('suggested') : undefined} error={fieldErrors.periodFrom} size="s">
              <Input id="closing-statement-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setSuggested((s) => ({ ...s, from: false })); }} className={suggested.from ? 'border-agent' : undefined} />
            </FormField>
            <FormField id="closing-statement-to" label={t('to')} required hint={suggested.to ? t('suggested') : undefined} error={fieldErrors.periodTo} size="s">
              <Input id="closing-statement-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setSuggested((s) => ({ ...s, to: false })); }} className={suggested.to ? 'border-agent' : undefined} />
            </FormField>
            {covers !== null ? (
              <FormCell as="p" size="full" className="text-meta text-ink-2" data-testid="closing-statement-covers" data-covers={covers}>
                {covers ? t('covers', { date: fmt.date(endsOn), amount: formatEuro(account.balanceAtYearEndCents) }) : t('notCovers', { date: fmt.date(endsOn) })}
              </FormCell>
            ) : null}
          </FormGrid>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={t('save')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['bytes', 'documentId', 'periodFrom', 'periodTo'])}
          testId="closing-statement-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
