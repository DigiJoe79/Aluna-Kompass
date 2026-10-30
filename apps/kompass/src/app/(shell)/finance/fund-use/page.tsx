import { hasPermission, isoNow, todayIn, userNamesFor } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { accountStatementsForYearInternal, listFinanceReportVersions, listFiscalYears, listFundsUseOpenings, reportDefinition, runFinanceReport, type FundsUseReport } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { formatEuro } from '@/lib/finance/amount';
import { loadReportAudit } from '@/lib/finance/entry-audit';
import { defaultReportYearId } from '@/lib/finance/report-params';
import { reportPageCount, versionPageCount } from '@/lib/finance/report-pages';
import { requireSession } from '@/lib/request-context';
import { ReportView } from '../reports/[key]/report-view';
import { FundsUseNotices } from './funds-use-notices';
import { fundsUseHead, fundsUseNotices } from './funds-use-view';
import { OpeningHeaderActions, OpeningsSection } from './openings-section';

const KEY = 'fundsUse';

/**
 * Mittelverwendung (Plan U2 Task 2; Designer Frage 4, Board 3a): die steuerliche Mittelverwendungsrechnung eines Jahres
 * als Seite in der Navigation — `ReportView` mit eigenem Kopfsatz (Pflicht oder freiwillig) statt des Zwecksatzes und
 * eigenen Warnungen; die Teile A–C stehen im PDF (Querformat). Immer ganz, ohne Schranke: Unter der Grenze ist die
 * Rechnung freiwillig und warnt nicht vor Fristen. Ohne `?year=` das Jahr wie auf der Berichtsseite. Kein Rückweg —
 * die Seite hängt in der Navigation (MUSTER § Seitenrahmen). Im ersten Kompass-Jahr dazu der Anfangsvortrag: Einstieg im
 * ⋯ des Kopfs, solange es keinen gibt, danach der Abschnitt über den Seiten (Task 3).
 */
export default async function FundUsePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { deps, ctx } = await requireSession();
  const canRead = hasPermission(ctx, 'finance.read');
  if (!canRead && !hasPermission(ctx, 'finance.overview')) return <Page width="task"><ForbiddenCard permission="finance.overview" /></Page>;
  const def = reportDefinition(KEY);
  if (!def) notFound();

  const t = await getTranslations('finance.fundUse');
  const tReports = await getTranslations('finance.reports');
  const yearsRes = await listFiscalYears(deps, ctx);
  const years = yearsRes.ok ? [...yearsRes.value].sort((a, b) => b.endsOn.localeCompare(a.endsOn)) : [];
  const query = await searchParams;
  const wanted = typeof query.year === 'string' ? query.year : null;
  const year = years.find((y) => y.id === wanted) ?? years.find((y) => y.id === defaultReportYearId(years, todayIn(deps)));
  if (!year) notFound();
  const params = { fiscalYearId: year.id };

  const run = await runFinanceReport(deps, ctx, { report: KEY, params });
  if (!run.ok) notFound();
  const report = run.value.data as FundsUseReport;
  const listed = await listFinanceReportVersions(deps, ctx, { report: KEY, params });
  const versions = listed.ok ? listed.value.versions : [];
  const names = userNamesFor(deps, versions.map((v) => v.byUserId));
  const title = t('title', { year: year.designation });
  const audit = await loadReportAudit(deps, ctx, { key: KEY, title: `${tReports(`${KEY}.title`)} ${year.designation}` }, { id: year.id, designation: year.designation });
  // Sperre „Auszug fehlt“ (13c) wie auf der Berichtsseite: ein Konto mit Recht → der Dialog aus Schritt 1.
  const block = run.value.finalizeBlock;
  const missing = block?.code === 'reportStatementsMissing' && hasPermission(ctx, 'finance.entriesWrite') ? accountStatementsForYearInternal(deps.db, year.id).filter((r) => r.kind === 'bank' && r.needsPdf && r.confirmation?.kind !== 'missingJustified') : [];
  const statementAccount = missing.length === 1 ? { accountId: missing[0]!.accountId, name: missing[0]!.name, lastMovementOn: missing[0]!.lastMovementOn, balanceAtYearEndCents: missing[0]!.balanceAtYearEndCents } : null;
  const finalVersion = run.value.finalVersion;
  const pages = run.value.empty ? null : finalVersion ? await versionPageCount(deps, ctx, finalVersion.reportId) : await reportPageCount(deps, ctx, KEY, params);

  // Anfangsvortrag (Task 3): nur auf der Seite des ersten Kompass-Jahres; die Nummer des Belegs, soweit die Akte sie zeigt.
  const openingsRes = await listFundsUseOpenings(deps, ctx, {});
  const openings = openingsRes.ok && openingsRes.value.firstFiscalYear?.id === year.id ? openingsRes.value : null;
  const documents: Record<string, string> = {};
  for (const o of openings?.openings ?? []) {
    if (!o.documentId) continue;
    const record = await getDocumentRecord(deps, ctx, o.documentId);
    if (record.ok && record.value.number) documents[o.documentId] = record.value.number;
  }
  const canEditOpenings = hasPermission(ctx, 'finance.setup');

  const head = fundsUseHead(report.head);
  const purpose = (
    <>
      {t(`head.${head.case}`, { year: year.designation, revenue: formatEuro(head.revenueCents), limit: head.limitCents === null ? '' : formatEuro(head.limitCents) })}
      {head.assetSalesCents > 0 ? ` ${t('head.assetSales', { amount: formatEuro(head.assetSalesCents) })}` : ''}
    </>
  );

  return (
    // Querformat braucht die Breite des Rahmens wie auf der Berichtsseite (Designer 2b: `full`).
    <Page width="full">
      <ReportView
        reportKey={KEY}
        title={title}
        orientation={def.orientation}
        pageCount={pages?.ok ? pages.value : null}
        finalVersion={finalVersion}
        empty={run.value.empty}
        finalizable={run.value.finalizable}
        group={def.group}
        running={todayIn(deps) <= year.endsOn}
        stage={run.value.stage}
        shortHash={run.value.shortHash}
        generatedAt={isoNow(deps.clock)}
        finalizeBlock={block}
        warnings={[]}
        probeDifferenceCents={null}
        combineAllowed={false}
        params={params}
        years={years.map((y) => ({ id: y.id, designation: y.designation }))}
        year={{ id: year.id, designation: year.designation }}
        canFinalize={hasPermission(ctx, 'finance.reportsFinalize')}
        canRelease={hasPermission(ctx, 'finance.periodClose')}
        canOpenVersions={canRead}
        audit={audit}
        statementAccount={statementAccount}
        endsOn={year.endsOn}
        closingLink={canRead}
        basePath="/finance/fund-use"
        purpose={purpose}
        headerActions={openings ? <OpeningHeaderActions overview={openings} yearId={year.id} canEdit={canEditOpenings} /> : undefined}
        notices={
          <>
            <FundsUseNotices notices={fundsUseNotices(report)} year={{ id: year.id, designation: year.designation }} />
            {openings ? <OpeningsSection overview={openings} canEdit={canEditOpenings} documents={documents} /> : null}
          </>
        }
        versions={versions.map((v) => ({ reportId: v.reportId, finalizedAt: v.finalizedAt, byName: names.get(v.byUserId) ?? tReports('list.system'), shortHash: v.shortHash, documentNumber: v.documentNumber, voidedAt: v.voidedAt, voidReason: v.voidReason }))}
      />
    </Page>
  );
}
