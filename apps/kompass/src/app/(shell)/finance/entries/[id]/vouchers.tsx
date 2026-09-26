'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { ReceiptList, type ReceiptListItem } from '@/components/finance/receipt-list';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { revokeVoucherAction, uploadVoucherAction } from '../actions';

/**
 * Belege einer festgeschriebenen Buchung (HANDOFF § 5.3): „Beleg nachreichen“
 * geht immer, auch im abgeschlossenen Jahr — dort verlangt Widerrufen einen
 * Ersatz.
 */
export function EntryVouchers({
  entryId,
  vouchers: initial,
  closedYear,
  documentationState,
}: {
  entryId: string;
  vouchers: ReceiptListItem[];
  closedYear: boolean;
  /** Spec 5.2 — nur ohne Beleg zeigt „statementSuffices“ etwas an; mit Beleg, Storno oder fehlendem Nachweis bleibt der Hinweis stumm. */
  documentationState?: 'voucher' | 'statementSuffices' | 'notApplicable' | 'missing';
}) {
  const t = useTranslations('finance.entryView.vouchers');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [vouchers, setVouchers] = useState(initial);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('entryId', entryId);
        formData.append('typeKey', 'voucher-own');
        formData.append('documentDate', new Date().toISOString().slice(0, 10));
        formData.append('file', file);
        const result = await uploadVoucherAction(formData);
        if (result.status !== 'success') {
          if (result.status === 'error') toast.error(result.message);
          continue;
        }
        const data = result.data as { linkId: string; documentId: string; documentNumber: string };
        setVouchers((prev) => [...prev, { linkId: data.linkId, documentNumber: data.documentNumber, title: file.name, typeLabel: t('type'), date: new Date().toISOString().slice(0, 10), viewHref: `/finance/entries/${entryId}/voucher/${data.documentId}`, revoked: false }]);
        router.refresh();
      } catch {
        toast.error(tCommon('uploadFailed'));
      }
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('title')}</h3>
      {vouchers.length === 0 && documentationState === 'statementSuffices' ? <p className="text-[13px] text-ink-2">{t('statementSuffices')}</p> : null}
      <ReceiptList items={vouchers} onRevoke={(linkId) => setRevokeTarget(linkId)} />
      <ReceiptDrop onFiles={(files) => void uploadFiles(files)} />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t('revoke.title')}
        description={closedYear ? t('revoke.descriptionClosed') : t('revoke.description')}
        confirmLabel={t('revoke.confirm')}
        destructive
        confirmDisabled={note.trim().length === 0}
        action={async () => {
          const result = await revokeVoucherAction(revokeTarget!, note);
          setNote('');
          router.refresh();
          return result;
        }}
      >
        <label className="mt-2 block space-y-1 text-[13px]">
          <span className="font-semibold">{t('revoke.noteLabel')}</span>
          <textarea required value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-sm border border-line-strong bg-field px-2.5 py-1.5 text-[13px]" rows={2} />
        </label>
      </ConfirmDialog>
    </section>
  );
}
