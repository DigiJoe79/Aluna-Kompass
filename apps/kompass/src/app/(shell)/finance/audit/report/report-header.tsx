'use client';

import type { AuditReportView } from '@kompass/module-finance';
import { Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { PageHeader } from '@/components/page-header';
import { RecordActions, type HeaderAction } from '@/components/record-actions';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useFileDownload } from '@/lib/use-file-download';
import { markReadyAction, revokeReadyAction } from '../actions';
import { useUnsavedCardTitles } from './unsaved-cards';

/**
 * Kopf der Seite „Prüfbericht“ (Board 12d): Titel mit Marke `auditReport`, ein Satz zum Stand, Primärknopf
 * „Zum Unterschreiben freigeben …“ (nächster Schritt im Ablauf, MUSTER § C — das Board zeigt ihn am Ende der Seite),
 * „Druckansicht“ bzw. „Drucken“ als Nebenaktion, „Freigabe zurücknehmen“ im ⋯, bis der Scan liegt. Drucken ist ein
 * POST — der Druck wird protokolliert.
 */
export function ReportHeader({ report, yearId, designation, canPrint }: { report: AuditReportView; yearId: string; designation: string; canPrint: boolean }) {
  const t = useTranslations('finance.audit.report');
  const fmt = useDateFormat();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const unsaved = useUnsavedCardTitles();
  const tAudit = useTranslations('finance.audit');
  const file = useFileDownload({ forbidden: tAudit('downloadRefused.forbidden'), notFound: tAudit('downloadRefused.notFound'), failed: tAudit('downloadRefused.failed') });
  const print = () => void file.download(`/finance/audit/report/${report.id}/print`, `Pruefbericht-${designation}.pdf`, { method: 'POST' });
  const title = report.kind === 'followUp' ? t('titleFollowUp', { year: designation }) : t('title', { year: designation });
  // Abgelegt: der Satz mit Link auf den Scan in der Akte (272).
  const scan = report.scans[0]?.documentId ?? null;
  const lead =
    report.state === 'filed'
      ? (
          <>
            {t('lead.filed', { date: fmt.date(report.filedAt) })}{' '}
            {scan ? (
              <Link href={`/dms/${encodeURIComponent(scan)}`} className="text-link underline-offset-2 hover:underline" data-testid="audit-report-scan-link">
                {t('lead.filedScan')}
              </Link>
            ) : (
              t('lead.filedScan')
            )}
          </>
        )
      : report.origin === 'blank'
        ? t('lead.blank')
        : report.state === 'readyToSign'
          ? t('lead.readyToSign', { date: fmt.date(report.readyAt) })
          : report.canEdit
            ? t('lead.draftEditor')
            : t('lead.draft');
  const editor = report.myAuditorId !== null && report.origin === 'kompass';
  const headerMore: HeaderAction[] = canPrint && report.state !== 'filed' ? [{ key: 'print', label: report.state === 'draft' ? t('preview') : t('print'), icon: <Printer className="size-4" aria-hidden />, disabled: file.busy, onSelect: print, testId: 'audit-report-print' }] : [];
  const revocable = editor && report.state === 'readyToSign' && report.scans.length === 0;

  return (
    <>
      <PageHeader
        back={{ href: `/finance/audit?year=${encodeURIComponent(yearId)}`, label: t('back', { year: designation }) }}
        title={title}
        status={
          <StatusBadge tone={statusTone('auditReport', report.state)} dot>
            {t(`state.${report.state}`)}
          </StatusBadge>
        }
        description={lead}
        more={headerMore}
        actions={
          <>
            {report.canEdit && report.state === 'draft' ? (
              <Button type="button" onClick={() => setReady(true)} data-testid="audit-report-ready">
                {t('ready.open')}
              </Button>
            ) : null}
            {revocable ? <RecordActions triggerRef={more} actions={[{ key: 'revoke', label: t('revoke'), kind: 'undoing', onSelect: () => setRevoking(true), testId: 'audit-report-revoke' }]} /> : null}
          </>
        }
      />
      <RefusalNotice action state={file.refusal} />
      <ConfirmDialog
        open={ready}
        onOpenChange={setReady}
        title={t('ready.title')}
        // Freigeben lädt den Stand neu: Was in einer Karte noch nicht gespeichert ist, ginge verloren (Plan D1d Task 6).
        description={unsaved.length > 0 ? `${t('ready.description')} ${t('ready.unsaved', { cards: new Intl.ListFormat('de', { type: 'conjunction' }).format(unsaved) })}` : t('ready.description')}
        confirmLabel={t('ready.confirm')}
        action={async () => {
          const result = await markReadyAction(report.id);
          if (result.status === 'success') {
            toast.success(t('ready.done'));
            router.refresh();
          }
          return result;
        }}
      />
      {revocable ? (
        <ConfirmDialog
          open={revoking}
          onOpenChange={setRevoking}
          title={t('revoke')}
          description={t('revokeDescription')}
          confirmLabel={t('revoke')}
          finalFocus={more}
          action={async () => {
            const result = await revokeReadyAction(report.id);
            if (result.status === 'success') {
              toast.success(t('revokeDone'));
              router.refresh();
            }
            return result;
          }}
        />
      ) : null}
    </>
  );
}
