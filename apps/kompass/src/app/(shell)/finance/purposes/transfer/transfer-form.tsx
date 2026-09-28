'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { StickyFooter } from '@/components/forms/sticky-footer';
import { Notice } from '@/components/notice';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { requestPurposeTransferAction, requestPurposeTransferUploadAction } from '../actions';

export interface TransferPurposeOption {
  id: string;
  name: string;
  /** Nur offene Zwecke sind als Ziel wählbar (Annahme 5: nie erfüllt oder aufgelöst). */
  open: boolean;
  balanceCents: number;
}

/**
 * E5 Formular (Designer-README 4e, Entscheidung 6): „von *: Zweck · Bestand …“
 * → „nach *“, Betrag, Datum, Begründung, Dokument Pflicht (aus der Akte oder
 * als PDF, nie beides). Fehler als `Notice refuse` über der Fußleiste. Die
 * Fußleiste klebt — eine schlichte, lokale Fassung; die gemeinsame baut
 * Teil A des Design-Nachtrags.
 */
export function TransferForm({ purposes, defaultFromId, today, approverNames }: { purposes: TransferPurposeOption[]; defaultFromId?: string; today: string; approverNames: string[] }) {
  const t = useTranslations('finance.purposes.transferDialog');
  const router = useRouter();
  const [fromId, setFromId] = useState(defaultFromId ?? '');
  const [toId, setToId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = amountText.trim() === '' ? null : parseAmount(amountText);
  const option = (p: TransferPurposeOption) => t('fromOption', { name: p.name, balance: formatEuro(p.balanceCents) });

  // „Zur Freigabe geben“ ist nie ausgegraut: Was fehlt, sagt die Ablehnung darüber (Muster D1).
  const missing = (): string | null => {
    if (!fromId && !toId) return t('missing.purposes');
    if (fromId === toId) return t('missing.same');
    if (amountCents === null || amountCents <= 0) return t('missing.amount');
    if (!date) return t('missing.date');
    if (reason.trim() === '') return t('missing.reason');
    if (!document && !file) return t('missing.document');
    return null;
  };

  const submit = async () => {
    const problem = missing();
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    const base = { fromPurposeId: fromId || null, toPurposeId: toId || null, amountCents: amountCents ?? 0, transferDate: date, reason: reason.trim() };
    let result;
    if (file) {
      const formData = new FormData();
      formData.append('fromPurposeId', base.fromPurposeId ?? '');
      formData.append('toPurposeId', base.toPurposeId ?? '');
      formData.append('amountCents', String(base.amountCents));
      formData.append('transferDate', base.transferDate);
      formData.append('reason', base.reason);
      formData.append('file', file);
      result = await requestPurposeTransferUploadAction(formData);
    } else {
      result = await requestPurposeTransferAction({ ...base, documentId: document!.id });
    }
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    toast.success(t('saved'));
    router.push('/finance/purposes');
  };

  return (
    <div className="space-y-4" data-testid="transfer-form">
      <section className="space-y-3.5 rounded-lg border border-line bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-from" required>
              {t('from')}
            </Label>
            <Select id="transfer-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">{t('freeFunds')}</option>
              {purposes.map((p) => (
                <option key={p.id} value={p.id}>
                  {option(p)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-to" required>
              {t('to')}
            </Label>
            <Select id="transfer-to" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">{t('freeFunds')}</option>
              {purposes
                .filter((p) => p.open)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {option(p)}
                  </option>
                ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-amount" required>
              {t('amount')}
            </Label>
            <Input id="transfer-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={formatAmount(0)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-date" required>
              {t('date')}
            </Label>
            <Input id="transfer-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="transfer-reason" required>
            {t('reason')}
          </Label>
          <Textarea id="transfer-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} />
        </div>
        <div className="space-y-1.5" data-testid="transfer-document">
          <p className="text-[13px] font-semibold text-ink">
            {t('documentLabel')} <span aria-hidden>*</span>
          </p>
          {document || file ? (
            <p className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 text-[13px]" data-testid="transfer-document-chosen">
              {document ? <span className="font-mono text-[12px]">{document.number}</span> : null}
              <span className="min-w-0 flex-1 truncate">{document ? document.subject : file!.name}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDocument(null);
                  setFile(null);
                }}
              >
                {t('documentRemove')}
              </Button>
            </p>
          ) : (
            <>
              <ReceiptDrop onFiles={(files) => setFile(files[0] ?? null)} onPickFromArchive={() => setArchiveOpen(true)} disabled={pending} />
              {archiveOpen ? (
                <DocumentPicker
                  id="transfer-document-picker"
                  name="documentId"
                  label={t('document')}
                  value={null}
                  onChange={(d) => {
                    if (d) {
                      setDocument(d);
                      setArchiveOpen(false);
                    }
                  }}
                />
              ) : null}
            </>
          )}
          <p className="text-[12px] text-muted-ink">{t('documentRequired')}</p>
        </div>
      </section>

      <StickyFooter testId="transfer-footer">
        {error ? (
          <div data-testid="transfer-error">
            <Notice level="refuse" title={t('refuseTitle')}>
              {error}
            </Notice>
          </div>
        ) : null}
        <p className="text-[12px] text-muted-ink" data-testid="transfer-approvers">
          {approverNames.length > 0 ? t('hint', { names: approverNames.join(' · ') }) : t('noApprover')}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Link href="/finance/purposes" className={buttonVariants({ variant: 'outline' })}>
            {t('cancel')}
          </Link>
          <Button type="button" disabled={pending} onClick={() => void submit()} data-testid="transfer-save">
            {t('submit')}
          </Button>
        </div>
      </StickyFooter>
    </div>
  );
}
