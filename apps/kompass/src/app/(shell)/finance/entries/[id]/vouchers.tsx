'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/forms/form-field';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { ReceiptList, type ReceiptListItem } from '@/components/finance/receipt-list';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import type { ActionState } from '@/lib/actions';
import { runAction, toastNetwork } from '@/lib/feedback';
import { revokeVoucherAction, uploadVoucherAction } from '../actions';

/**
 * Belege einer festgeschriebenen Buchung (HANDOFF § 5.3): „Beleg nachreichen“
 * geht immer, auch im abgeschlossenen Jahr — dort verlangt Widerrufen einen
 * Ersatz.
 */
export function EntryVouchers({
  today,
  entryId,
  vouchers: initial,
  closedYear,
  documentationState,
  origin,
}: {
  /** Belegdatum eines hochgeladenen Belegs: „heute“ in der Zeitzone des Vereins, vom Server (Befund 47). */
  today: string;
  entryId: string;
  vouchers: ReceiptListItem[];
  closedYear: boolean;
  /** Spec 5.2 — nur ohne Beleg zeigt „statementSuffices“ etwas an; mit Beleg, Storno oder fehlendem Nachweis bleibt der Hinweis stumm. */
  documentationState?: 'voucher' | 'statementSuffices' | 'notApplicable' | 'missing' | 'onOrigin';
  /** F7 Task 4 (Annahme 12): nur bei `onOrigin` — wohin der Link zeigt. */
  origin?: { entity: 'financeExpenseClaim' | 'financePartnerPayment'; id: string };
}) {
  const t = useTranslations('finance.entryView.vouchers');
  const router = useRouter();
  const [vouchers, setVouchers] = useState(initial);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });
  const tCommon = useTranslations('common');

  const uploadFiles = async (files: File[]) => {
    setRefusal({ status: 'idle' });
    for (const file of files) {
      const formData = new FormData();
      formData.append('entryId', entryId);
      formData.append('typeKey', 'voucher-own');
      formData.append('documentDate', today);
      formData.append('file', file);
      // Der Hinweis zu einem Beleg ist eine Warnung, kein Erfolgs-Toast — darum nicht über den Feedback-Haken.
      const result = await runAction(() => uploadVoucherAction(formData), tCommon('network'));
      if (result.status !== 'success') {
        if (result.status === 'error') {
          if (result.kind === 'network') toastNetwork(result, tCommon('retry'), () => void uploadFiles([file]));
          else setRefusal(result);
        }
        continue;
      }
      if (result.message) toast.warning(result.message);
      const data = result.data as { linkId: string; documentId: string; documentNumber: string };
      setVouchers((prev) => [...prev, { linkId: data.linkId, documentNumber: data.documentNumber, title: file.name, typeLabel: t('type'), date: today, viewHref: `/finance/entries/${entryId}/voucher/${data.documentId}`, revoked: false }]);
      router.refresh();
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('title')}</h3>
      {vouchers.length === 0 && documentationState === 'statementSuffices' ? <p className="text-[13px] text-ink-2">{t('statementSuffices')}</p> : null}
      {documentationState === 'onOrigin' && origin ? (
        <p className="text-[13px] text-ink-2">
          {t('onOrigin')}{' '}
          <Link href={origin.entity === 'financeExpenseClaim' ? `/finance/approvals?claim=${origin.id}` : `/finance/approvals?payment=${origin.id}`} className="text-link underline">
            {t('onOriginLink')}
          </Link>
        </p>
      ) : null}
      <ReceiptList items={vouchers} onRevoke={(linkId) => setRevokeTarget(linkId)} />
      <RefusalNotice action state={refusal} />
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
          if (result.status === 'success') setNote('');
          router.refresh();
          return result;
        }}
      >
        <div className="mt-2">
          <FormField id="voucher-revoke-note" label={t('revoke.noteLabel')}>
            <Textarea id="voucher-revoke-note" required value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </FormField>
        </div>
      </ConfirmDialog>
    </section>
  );
}
