import { hasPermission, todayIn } from '@kompass/core';
import { listConfirmations, listNotices, listUncertifiedDonations, type ConfirmationView } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ListPager } from '@/components/list-pager';
import { ViewTabs } from '@/components/view-tabs';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
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
  page?: string;
}

/** Zeilen je Seite — bis 0.2.8 eine stille Grenze bei 200 (Inventar Filterleisten, Befund 10). */
const PAGE_SIZE = 50;

/**
 * Zuwendungsbestätigungen (C1, F6a Task 7) — lesen mit `finance.read`,
 * ausstellen, zurücknehmen, Versand und unterschriebene Fassung mit
 * `finance.donationsIssue`. Reiter aus der Adresse: Ausgestellt · Noch nicht
 * bestätigt · Zu korrigieren (n) · Unterschrift fehlt (n).
 */
export default async function FinanceDonationsPage({ searchParams }: { searchParams: Promise<DonationsQuery> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.donations');

  const query = await searchParams;
  const tab: DonationTab = donationTab(query.tab);
  const minCents = query.min && /^\d+$/.test(query.min) ? Number(query.min) : null;
  const canIssue = hasPermission(ctx, 'finance.donationsIssue');
  const canDescribe = hasPermission(ctx, 'finance.entriesWrite');
  const today = todayIn(deps);

  const listTab = tab === 'uncertified' ? 'issued' : tab;
  // Ein Verweis `?confirmation=` (Spendenbuch, Buchung) ohne Seite schlägt die Seite auf, auf der die Bestätigung
  // steht — gesucht unter den ersten 200 wie bis 0.2.8.
  let page = Math.max(1, Number(query.page) || 1);
  if (!query.page && query.confirmation && tab !== 'uncertified') {
    const lookup = await listConfirmations(deps, ctx, { tab: listTab, limit: 200 });
    const at = lookup.ok ? lookup.value.items.findIndex((c) => c.id === query.confirmation) : -1;
    if (at >= 0) page = Math.floor(at / PAGE_SIZE) + 1;
  }
  const offset = (page - 1) * PAGE_SIZE;
  const [confirmationsRes, noticesRes, uncertifiedRes] = await Promise.all([
    listConfirmations(deps, ctx, { tab: listTab, limit: PAGE_SIZE, offset: tab === 'uncertified' ? 0 : offset }),
    listNotices(deps, ctx, { includeInactive: true }),
    tab === 'uncertified' ? listUncertifiedDonations(deps, ctx, { minCents: minCents ?? undefined, limit: PAGE_SIZE, offset }) : Promise.resolve(null),
  ]);
  if (!confirmationsRes.ok) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const { items, counts } = confirmationsRes.value;
  const listTotal = tab === 'uncertified' ? (uncertifiedRes?.ok ? uncertifiedRes.value.total : 0) : confirmationsRes.value.total;
  // „{Treffer} von {alle}“ für „Noch nicht bestätigt“: alle Personen ohne Mindestbetrag.
  const uncertifiedAllRes = tab === 'uncertified' && minCents !== null ? await listUncertifiedDonations(deps, ctx, { limit: 1 }) : null;
  const uncertifiedAll = uncertifiedAllRes?.ok ? uncertifiedAllRes.value.total : listTotal;
  const pageHref = (next: number) => {
    const params = new URLSearchParams();
    if (tab !== 'issued') params.set('tab', tab);
    if (tab === 'uncertified' && minCents !== null) params.set('min', String(minCents));
    const target = Math.floor(next / PAGE_SIZE) + 1;
    if (target > 1) params.set('page', String(target));
    const qs = params.toString();
    return qs ? `/finance/donations?${qs}` : '/finance/donations';
  };
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
    recall: c.voidedAt && c.sentBeforeVoid ? { originalReturnedOn: c.originalReturnedOn, taxOfficeInformedOn: c.taxOfficeInformedOn } : null,
    lines: c.lines.map(({ lineId, entryId, entryNumber, amountCents }) => ({ lineId, entryId, entryNumber, amountCents })),
    notice: notices.get(c.noticeId) ?? null,
  });

  // Die Zahl steht als Marke am Reiter (ViewTabs), nicht mehr als „({count})“ im Text.
  const tabCount = (key: DonationTab) => (key === 'toCorrect' ? counts.toCorrect : key === 'needsSignature' ? counts.needsSignature : undefined);

  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <div className="space-y-4">

        <ViewTabs
          label={t('tabsGroup')}
          current={tab}
          tabs={DONATION_TABS.map((key) => ({ key, label: t(`tabs.${key}`), href: key === 'issued' ? '/finance/donations' : `/finance/donations?tab=${key}`, count: tabCount(key) }))}
        />

        {tab === 'uncertified' ? (
          <UncertifiedList groups={uncertifiedRes?.ok ? uncertifiedRes.value.groups : []} minCents={minCents} count={{ shown: listTotal, total: uncertifiedAll }} canIssue={canIssue} canDescribe={canDescribe} today={today} />
        ) : tab === 'needsSignature' ? (
          <SignatureSteps rows={items.map((c) => ({ id: c.id, number: c.documentNumber, issuedOn: c.issuedOn, contactName: c.contactName, totalCents: c.totalCents, signed: c.signatureState === 'signed' }))} canIssue={canIssue} />
        ) : items.length === 0 ? (
          <EmptyState title={t(`empty.${tab}.title`)} text={t(`empty.${tab}.text`)} />
        ) : (
          <ConfirmationsTable
            rows={items.map(rowOf)}
            canIssue={canIssue}
            initialOpenId={query.confirmation ?? null}
            today={today}
            footer={<ListPager total={listTotal} offset={offset} pageSize={PAGE_SIZE} hrefFor={pageHref} footer testId="donations-pager" />}
          />
        )}
        {/* Ohne gemeinsame Karte (Personen-Gruppen, Unterschrift-Schritte) steht der Pager direkt unter der Liste. */}
        {tab === 'uncertified' || tab === 'needsSignature' ? <ListPager total={listTotal} offset={offset} pageSize={PAGE_SIZE} hrefFor={pageHref} testId="donations-pager" /> : null}
      </div>
    </Page>
  );
}
