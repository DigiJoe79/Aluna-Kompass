'use client';

import type { TransferView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ActionState } from '@/lib/actions';
import { toast } from 'sonner';
import { ApprovalDetailFrame, type ApprovalFooter } from '@/components/finance/approval-detail-frame';
import { BeforeAfter } from '@/components/before-after';
import { Notice } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { useDateFormat } from '@/components/date-format-provider';
import { formatEuro } from '@/lib/finance/amount';
import { approvePurposeTransferAction, rejectPurposeTransferAction } from '../purposes/actions';
import { RejectDialog } from './reject-dialog';

/**
 * Die gemeinsame Detailansicht für eine Umwidmung (F8b Task 3/6a, Annahme 5,
 * Designer-README 4e/3h): `ApprovalDetailFrame` mit „von → nach“ und dem
 * Bestand je Seite als `BeforeAfter`, klebende Fußleiste. `?transfer=` wählt.
 */
export function PurposeTransferDetail({ transfer, creatorName, nextHref }: { transfer: TransferView; creatorName: string; nextHref: string | null }) {
  const t = useTranslations('finance.approvals');
  const fmt = useDateFormat();
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<ActionState | null>(null);

  const sideLabel = (side: { name: string | null }) => side.name ?? t('transfer.freeFunds');

  if (transfer.state !== 'submitted') {
    const approved = transfer.state === 'approved';
    return (
      <section data-testid="purpose-transfer-result" aria-live="polite" className="space-y-4 rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[15px] font-semibold">{transfer.number}</span>
          <StatusBadge tone={approved ? 'success' : 'neutral'}>{approved ? t('transferResult.approved') : t('transferResult.rejected')}</StatusBadge>
        </div>
        <p className="font-mono text-[26px] font-semibold tabular-nums">{formatEuro(transfer.amountCents)}</p>
        <p className="text-[14px] text-ink">
          {sideLabel(transfer.from)} → {sideLabel(transfer.to)}
        </p>
        {!approved && transfer.rejectNote ? <p className="text-[14px] text-ink-2">{transfer.rejectNote}</p> : null}
        <div className="border-t border-line pt-3">
          {nextHref ? (
            <Link href={nextHref} className={buttonVariants({ variant: 'default' })}>
              {t('transferResult.next')}
            </Link>
          ) : (
            <p className="text-[13px] text-muted-ink">{t('transferResult.none')}</p>
          )}
        </div>
      </section>
    );
  }

  const approve = async () => {
    setPending(true);
    const result = await approvePurposeTransferAction(transfer.id);
    setPending(false);
    if (result.status === 'error') {
      setRefusal(result);
      return;
    }
    setRefusal(null);
    toast.success(result.status === 'success' ? result.message ?? '' : '');
    router.refresh();
  };

  const rows = [{ label: t('transfer.change'), before: sideLabel(transfer.from), after: sideLabel(transfer.to) }];
  if (transfer.from.purposeId) rows.push({ label: t('transfer.balance', { name: sideLabel(transfer.from) }), before: formatEuro(transfer.from.beforeCents ?? 0), after: formatEuro(transfer.from.afterCents ?? 0) });
  if (transfer.to.purposeId) rows.push({ label: t('transfer.balance', { name: sideLabel(transfer.to) }), before: formatEuro(transfer.to.beforeCents ?? 0), after: formatEuro(transfer.to.afterCents ?? 0) });

  // Voraussetzungen (F8b 6a): der Beschluss liegt vor; die Quelle im Minus ist eine Warnung, keine Sperre (Annahme 5).
  const requirements = (
    <div className="space-y-2" data-testid="purpose-transfer-requirements">
      <h3 className="text-[13px] font-semibold uppercase tracking-[.04em] text-muted-ink">{t('transfer.requirements')}</h3>
      {transfer.documentId ? (
        <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
          <StatusBadge tone="success" dot>{t('transfer.document')}</StatusBadge>
          <a href={`/dms/${transfer.documentId}/file`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold underline underline-offset-2" data-testid="purpose-transfer-document">
            {t('transfer.documentOpen')}
          </a>
        </p>
      ) : (
        <StatusBadge tone="error">{t('transfer.documentMissing')}</StatusBadge>
      )}
      {transfer.sourceWouldGoNegative ? <Notice level="warn">{t('transfer.sourceWarning')}</Notice> : null}
      <p className="text-[13px] text-ink-2">{t('transfer.effective', { date: fmt.date(transfer.transferDate) })}</p>
    </div>
  );

  const footer: ApprovalFooter = {
    state: refusal ?? undefined,
    note: <p className="text-[12px] text-muted-ink">{t('footer.humanOnly')}</p>,
    reject: (
      <Button type="button" variant="outline" onClick={() => setRejecting(true)} data-testid="purpose-transfer-reject">
        {t('transferReject.trigger')}
      </Button>
    ),
    approve: { label: t('transferApprove.trigger'), pending, onClick: () => void approve(), testId: 'purpose-transfer-approve' },
  };

  return (
    <>
    <ApprovalDetailFrame
      head={{
        kind: t('kind.purposeTransfer'),
        number: transfer.number,
        amount: formatEuro(transfer.amountCents),
        person: creatorName,
        received: t('head.receivedAt', { at: fmt.dateTime(transfer.createdAt) }),
        note: `${t('transfer.reason')}: ${transfer.reason}`,
      }}
      requirements={requirements}
      footer={footer}
    >
      <div data-testid="purpose-transfer-detail">
        <BeforeAfter rows={rows} />
      </div>
    </ApprovalDetailFrame>
    <RejectDialog
      open={rejecting}
      onOpenChange={setRejecting}
      number={transfer.number}
      person={creatorName}
      title={t('transferReject.title', { number: transfer.number })}
      who={t('transferReject.who', { name: creatorName })}
      onReject={(note) => rejectPurposeTransferAction(transfer.id, note)}
    />
    </>
  );
}
