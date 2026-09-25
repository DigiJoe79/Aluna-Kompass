import { hasPermission, isModuleEnabled, listUserNamesWithPermission, readSetting } from '@kompass/core';
import { FACSIMILE_MAX_BYTES, getMachineProcedure, listNotices, noticeExpiryInternal } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Notice } from '@/components/notice';
import { PageHeader } from '@/components/page-header';
import { formatDate } from '@/lib/dates';
import { requireSession } from '@/lib/request-context';
import { AddNoticeButton } from './add-notice-button';
import { MachinePanel } from './machine-panel';
import { NoticesTable } from './notices-table';

/**
 * Bescheide und maschinelles Verfahren (C3, F6a Task 8) — lesen mit
 * `finance.read`, erfassen, aufheben, irrtümlich kennzeichnen, Unterzeichner
 * und Faksimile mit `finance.donationsIssue`. Gültigkeit und Zustand rechnen
 * die Dienste (`listNotices`, `getMachineProcedure`).
 */
export default async function FinanceDonationNoticesPage() {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'finance')) return <ModuleInactiveCard namespace="finance.common" />;
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.donations.notices');

  const [noticesRes, machineRes] = await Promise.all([listNotices(deps, ctx, { includeInactive: true }), getMachineProcedure(deps, ctx)]);
  if (!noticesRes.ok || !machineRes.ok) return <ForbiddenCard permission="finance.read" />;
  const notices = noticesRes.value;

  const canIssue = hasPermission(ctx, 'finance.donationsIssue');
  const canPickDocument = hasPermission(ctx, 'dms.view');
  const canDraftLetter = hasPermission(ctx, 'dms.create');
  const draftNames = canDraftLetter ? [] : listUserNamesWithPermission(deps, 'dms.create');
  const today = deps.clock.now().toISOString().slice(0, 10);
  const expiry = noticeExpiryInternal(deps.db, today, readSetting<number>(deps, 'finance.noticeExpiryWarnMonths'));
  const hasValid = notices.some((n) => n.state === 'valid');
  const dateMode = readSetting<'locale' | 'iso'>(deps, 'ui.dateFormat');

  return (
    <div className="max-w-[1100px] space-y-5">
      <PageHeader title={t('title')} description={t('description')} actions={canIssue ? <AddNoticeButton canPickDocument={canPickDocument} /> : undefined} />

      {!hasValid ? <Notice level="warn">{t('noValid')}</Notice> : expiry ? <Notice level="warn">{t('expiring', { date: formatDate(expiry.validUntil, dateMode) })}</Notice> : null}

      {notices.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        <NoticesTable
          rows={notices.map(({ id, kind, taxOffice, taxNumber, noticeDate, assessmentPeriod, purposesText, validUntil, state, supersededOn, voidedAt, documentId, documentNumber, supersededDocumentNumber }) => ({ id, kind, taxOffice, taxNumber, noticeDate, assessmentPeriod, purposesText, validUntil, state, supersededOn, voidedAt, documentId, documentNumber, supersededDocumentNumber }))}
          canIssue={canIssue}
          canPickDocument={canPickDocument}
        />
      )}

      <MachinePanel signers={machineRes.value.signers} status={machineRes.value.status} canIssue={canIssue} canDraftLetter={canDraftLetter} draftNames={draftNames} facsimileMaxBytes={FACSIMILE_MAX_BYTES} />
    </div>
  );
}
