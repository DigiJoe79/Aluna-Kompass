import { hasPermission, userNamesFor } from '@kompass/core';
import { getAuditSection, getAuditStatus, listAccounts, listAuditors, type AuditSectionRow } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { AUDIT_SECTION_ORDER, isAuditSection, SECTION_PAGE_SIZE } from '@/lib/finance/audit-sections';
import { resolveAuditYear } from '@/lib/finance/audit-year';
import { requireSession } from '@/lib/request-context';
import { ReviewBar } from './review-bar';
import { SectionTable } from './section-table';

/** Nutzer-IDs, die in den Werten der Auffälligkeiten stehen (Wiederöffnung, Verknüpfung). */
const userIdsOf = (rows: AuditSectionRow[]) => rows.flatMap((r) => [r.labelParams.byUserId, r.labelParams.userId]).filter((v): v is string => typeof v === 'string' && v.length > 0);

/**
 * Ein Abschnitt des Prüfpakets als eigene Seite (Board 4b): Liste im Stand der Prüffassung mit Suche, Stichprobe und
 * Konto, blätternd; am Ende „Abschnitt durchgesehen“ und „Weiter mit …“. `full` (Board). Unbekannter Abschnitt: 404.
 */
export default async function AuditSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ year?: string; q?: string; sample?: string; account?: string; offset?: string; ids?: string }> }) {
  const { section } = await params;
  if (!isAuditSection(section)) notFound();
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.audit')) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.audit');
  const query = await searchParams;
  const { year } = await resolveAuditYear(deps, ctx, query.year);
  const n = AUDIT_SECTION_ORDER.indexOf(section) + 1;
  const title = t('package.numbered', { n, title: t(`sections.${section}.title`) });
  if (!year) notFound();
  const back = { href: `/finance/audit?year=${encodeURIComponent(year.id)}`, label: t('section.back', { year: year.designation }) };

  const statusRes = await getAuditStatus(deps, ctx, { fiscalYearId: year.id });
  if (!statusRes.ok) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const status = statusRes.value;
  if (status.yearStatus !== 'closed' || !status.baseline) {
    return (
      <Page width="full" header={<PageHeader title={title} back={back} />}>
        <EmptyState title={t('section.empty.title')} text={t('package.notReady')} />
      </Page>
    );
  }

  // Der Filter „Stichprobe“ gilt nur in der Prüferansicht — die Schatzmeisterin hat kein eigenes Kästchen (Plan D1d Task 6).
  const sample = status.me.auditorId !== null && ['sampled', 'open', 'recheck'].includes(query.sample ?? '') ? (query.sample as 'sampled' | 'open' | 'recheck') : undefined;
  const text = query.q?.trim() || undefined;
  const accountId = section === 'journal' && query.account ? query.account : undefined;
  const entryIds = query.ids ? query.ids.split(',').filter(Boolean).slice(0, 2000) : undefined;
  const offset = Math.max(0, Number.parseInt(query.offset ?? '0', 10) || 0);
  const listed = await getAuditSection(deps, ctx, { fiscalYearId: year.id, section, text, sample, accountId, entryIds, limit: SECTION_PAGE_SIZE, offset });
  if (!listed.ok) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const filtered = Boolean(text || sample || accountId || entryIds);
  const all = filtered ? await getAuditSection(deps, ctx, { fiscalYearId: year.id, section, limit: 1 }) : listed;
  const unfiltered = all.ok ? all.value.total : listed.value.total;

  const auditorsRes = await listAuditors(deps, ctx, { fiscalYearId: year.id });
  const auditors = auditorsRes.ok ? auditorsRes.value.auditors : [];
  const nameOf = (id: string) => auditors.find((a) => a.id === id)?.contactName ?? '';
  const myAuditorId = status.me.auditorId;
  const mine = listed.value.reviewedBy.find((r) => r.auditorId === myAuditorId) ?? null;
  const others = listed.value.reviewedBy.filter((r) => r.auditorId !== myAuditorId).map((r) => nameOf(r.auditorId)).filter(Boolean);
  const previous = listed.value.previousReview;
  // „durchgesehen vor der Nachprüfung“ nur, wenn es eine Nachprüfung gibt (Befund 7).
  const followUp = status.followUpOpen || status.report?.kind === 'followUp';
  const reviewedBefore = previous && followUp ? { names: previous.auditorIds.map(nameOf).filter(Boolean), at: previous.at } : null;
  const accountsRes = section === 'journal' ? await listAccounts(deps, ctx, { includeInactive: true }) : null;
  const accounts = accountsRes?.ok ? accountsRes.value.map((a) => ({ id: a.id, name: a.name })) : [];
  const userNames = Object.fromEntries(userNamesFor(deps, userIdsOf(listed.value.rows)));

  const nextSection = AUDIT_SECTION_ORDER[n] ?? null;
  const description =
    section === 'journal'
      ? t('sections.journal.description', { year: year.designation, sampled: status.samples.sampledEntries, total: status.samples.totalEntries })
      : t(`sections.${section}.description`, { year: year.designation });

  return (
    <Page width="full" header={<PageHeader title={title} description={description} back={back} />}>
      <div className="flex flex-col gap-5">
        <SectionTable
          yearId={year.id}
          designation={year.designation}
          section={section}
          auditorView={myAuditorId !== null}
          rows={listed.value.rows}
          accounts={accounts}
          filters={{ text: query.q ?? '', sample: sample ?? '', account: accountId ?? '', ids: entryIds?.join(',') ?? '' }}
          total={listed.value.total}
          unfiltered={unfiltered}
          offset={offset}
          userNames={userNames}
          fixed={status.workFixedSince !== null}
        />
        <ReviewBar
          yearId={year.id}
          section={section}
          auditorView={myAuditorId !== null}
          reviewedByMeAt={mine?.at ?? null}
          others={others}
          reviewedBefore={reviewedBefore}
          fixedSince={status.workFixedSince}
          next={nextSection ? { section: nextSection, n: n + 1, title: t(`sections.${nextSection}.title`) } : null}
        />
      </div>
    </Page>
  );
}
