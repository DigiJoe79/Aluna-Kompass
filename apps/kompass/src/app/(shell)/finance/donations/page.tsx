import { hasPermission } from '@kompass/core';
import { listConfirmations, listNotices, listUncertifiedDonations, type ConfirmationView } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { donationTab, DONATION_TABS, type DonationTab } from '@/lib/finance/donations';
import { requireSession } from '@/lib/request-context';
import { ConfirmationsTable, type ConfirmationRow } from './confirmations-table';
import { SignatureSteps } from './signature-steps';
import { UncertifiedList } from './uncertified-list';

export interface DonationsQuery {
  tab?: string;
  min?: string;
  confirmation?: string;
}

/**
 * Zuwendungsbestätigungen (C1, F6a Task 7) — lesen mit `finance.read`,
 * ausstellen, zurücknehmen, Versand und unterschriebene Fassung mit
 * `finance.donationsIssue`. Reiter aus der Adresse: Ausgestellt · Noch nicht
 * bestätigt · Zu korrigieren (n) · Unterschrift fehlt (n).
 */
export default async function FinanceDonationsPage({ searchParams }: { searchParams: Promise<DonationsQuery> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.donations');

  const query = await searchParams;
  const tab: DonationTab = donationTab(query.tab);
  const minCents = query.min && /^\d+$/.test(query.min) ? Number(query.min) : null;
  const canIssue = hasPermission(ctx, 'finance.donationsIssue');
  const canDescribe = hasPermission(ctx, 'finance.entriesWrite');
  const today = deps.clock.now().toISOString().slice(0, 10);

  const listTab = tab === 'uncertified' ? 'issued' : tab;
  const [confirmationsRes, noticesRes, uncertifiedRes] = await Promise.all([
    listConfirmations(deps, ctx, { tab: listTab, limit: 200 }),
    listNotices(deps, ctx, { includeInactive: true }),
    tab === 'uncertified' ? listUncertifiedDonations(deps, ctx, { minCents: minCents ?? undefined, limit: 200 }) : Promise.resolve(null),
  ]);
  if (!confirmationsRes.ok) return <ForbiddenCard permission="finance.read" />;
  const { items, counts } = confirmationsRes.value;
  const notices = new Map((noticesRes.ok ? noticesRes.value : []).map((n) => [n.id, { kind: n.kind, noticeDate: n.noticeDate }]));

  const rowOf = (c: ConfirmationView): ConfirmationRow => ({
    id: c.id,
    number: c.documentNumber,
    issuedOn: c.issuedOn,
    contactName: c.contactName,
    kind: c.kind,
    totalCents: c.totalCents,
    periodFrom: c.periodFrom,
    periodTo: c.periodTo,
    sentAt: c.sentAt,
    sentVia: c.sentVia,
    state: c.state,
    toCorrect: c.toCorrect,
    machine: c.machine,
    expenseWaiver: c.expenseWaiver,
    signatureState: c.signatureState,
    voidedAt: c.voidedAt,
    lines: c.lines.map(({ lineId, entryId, entryNumber, amountCents }) => ({ lineId, entryId, entryNumber, amountCents })),
    notice: notices.get(c.noticeId) ?? null,
  });

  const tabLabel = (key: DonationTab) => (key === 'toCorrect' ? t('tabs.toCorrect', { count: counts.toCorrect }) : key === 'needsSignature' ? t('tabs.needsSignature', { count: counts.needsSignature }) : t(`tabs.${key}`));

  return (
    <div className="max-w-[1100px] space-y-4">
      <PageHeader title={t('title')} description={t('description')} />

      <div role="tablist" aria-label={t('tabsGroup')} className="inline-flex h-[var(--field-h)] overflow-hidden rounded-md border border-line-strong">
        {DONATION_TABS.map((key) => (
          <Link
            key={key}
            href={key === 'issued' ? '/finance/donations' : `/finance/donations?tab=${key}`}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'bg-selected px-3 py-1.5 text-[13px] font-semibold text-selected-ink' : 'bg-surface-2 px-3 py-1.5 text-[13px] text-ink-2'}
          >
            {tabLabel(key)}
          </Link>
        ))}
      </div>

      {tab === 'uncertified' ? (
        <UncertifiedList groups={uncertifiedRes?.ok ? uncertifiedRes.value.groups : []} minCents={minCents} canIssue={canIssue} canDescribe={canDescribe} today={today} />
      ) : tab === 'needsSignature' ? (
        <SignatureSteps rows={items.map((c) => ({ id: c.id, number: c.documentNumber, issuedOn: c.issuedOn, contactName: c.contactName, totalCents: c.totalCents, signed: c.signatureState === 'signed' }))} canIssue={canIssue} />
      ) : items.length === 0 ? (
        <EmptyState title={t(`empty.${tab}.title`)} text={t(`empty.${tab}.text`)} />
      ) : (
        <ConfirmationsTable rows={items.map(rowOf)} canIssue={canIssue} initialOpenId={query.confirmation ?? null} today={today} />
      )}
    </div>
  );
}
