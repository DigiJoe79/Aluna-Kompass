import { hasPermission, isoNow, todayIn, userNamesFor, type LocalizedText } from '@kompass/core';
import { accountStatementsForYearInternal, listFinanceReportVersions, listFiscalYears, listTaxPeriods, reportDefinition, runFinanceReport } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { DATE_REPORTS, defaultReportYearId, PERIOD_REPORTS, PERIOD_SPAN_REPORTS, reportParamsFromQuery } from '@/lib/finance/report-params';
import { choosePeriod } from '../../tax/types';
import { loadReportAudit } from '@/lib/finance/entry-audit';
import { reportPageCount, versionPageCount } from '@/lib/finance/report-pages';
import { requireSession } from '@/lib/request-context';
import { ReportView } from './report-view';

/**
 * Ein Bericht als Detailseite (Board 2b, Designer Runde 2 11c). Der Kopf mit Rückweg entsteht in `ReportView` (der
 * Download braucht den Client); `back={…}` steht hier, wo der Wächter `back-navigation` ihn liest. Unbekannter oder
 * noch nicht verfügbarer Bericht (Mittelverwendung) → `not-found`.
 */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { key } = await params;
  const def = reportDefinition(key);
  if (!def || !def.available) notFound();
  const { deps, ctx } = await requireSession();
  const canRead = hasPermission(ctx, 'finance.read');
  if (!canRead && (def.personal || !hasPermission(ctx, 'finance.overview'))) return <Page width="standard"><ForbiddenCard permission={def.personal ? 'finance.read' : 'finance.overview'} /></Page>;

  const t = await getTranslations('finance.reports');
  const yearsRes = await listFiscalYears(deps, ctx);
  const years = yearsRes.ok ? [...yearsRes.value].sort((a, b) => b.endsOn.localeCompare(a.endsOn)) : [];
  const fallback = defaultReportYearId(years, todayIn(deps));
  if (!fallback) notFound();
  const query = await searchParams;
  let reportParams = reportParamsFromQuery(key, query, fallback, { today: todayIn(deps) });
  // Ein Bericht je Erklärungszeitraum (15i): Vorgabe der neueste offene Zeitraum; ohne Zeitraum zur Steuererklärung,
  // wo man ihn anlegt. Das Jahr für Rückweg und Sperren ist das letzte des Zeitraums. Der Rücklagenspiegel mit
  // `?period=` (Befund 18 d) ebenso, über die Jahre des Zeitraums — die Fassung, die die Beilage meint.
  const periodQuery = typeof query.period === 'string' ? query.period : undefined;
  const bySpan = PERIOD_SPAN_REPORTS.includes(key) && periodQuery !== undefined;
  const byPeriod = PERIOD_REPORTS.includes(key) || bySpan;
  const periodsRes = byPeriod ? await listTaxPeriods(deps, ctx, {}) : null;
  const periods = periodsRes?.ok ? periodsRes.value : [];
  const period = byPeriod ? choosePeriod(periods, bySpan ? periodQuery : reportParams.taxPeriodId) : null;
  if (byPeriod && !period) redirect('/finance/tax');
  if (period) reportParams = bySpan ? { fiscalYearIds: period.fiscalYearIds } : { taxPeriodId: period.id };
  // Ein Bericht zu einem Stichtag (Übergabeliste): das Jahr ist das Geschäftsjahr des Tages — für Rückweg und Kopf.
  const byDate = DATE_REPORTS.includes(key);
  const year = period ? years.find((y) => y.id === period.lastFiscalYearId) : byDate ? years.find((y) => y.startsOn <= reportParams.date! && reportParams.date! <= y.endsOn) : years.find((y) => y.id === reportParams.fiscalYearId);
  if (!year) notFound();

  let run = await runFinanceReport(deps, ctx, { report: key, params: reportParams });
  // Eine alte Adresse mit „zusammengefasst“ für ein Jahr, das es nicht zulässt: ohne die Darstellung statt 404.
  if (!run.ok && reportParams.combineOperations) {
    reportParams = { fiscalYearId: reportParams.fiscalYearId };
    run = await runFinanceReport(deps, ctx, { report: key, params: reportParams });
  }
  if (!run.ok) notFound();
  const listed = await listFinanceReportVersions(deps, ctx, { report: key, params: reportParams });
  const versions = listed.ok ? listed.value.versions : [];
  const names = userNamesFor(deps, versions.map((v) => v.byUserId));
  const title = `${t(`${key}.title`)} ${period ? period.label : year.designation}`;
  const audit = await loadReportAudit(deps, ctx, { key, title }, { id: year.id, designation: year.designation });
  // Sperre „Auszug fehlt“ (13c): bei genau einem Konto und Recht zum Ablegen der Knopf mit dem Dialog aus Schritt 1.
  const block = run.value.finalizeBlock;
  const missing = block?.code === 'reportStatementsMissing' && hasPermission(ctx, 'finance.entriesWrite') ? accountStatementsForYearInternal(deps.db, year.id).filter((r) => r.kind === 'bank' && r.needsPdf && r.confirmation?.kind !== 'missingJustified') : [];
  const statementAccount = missing.length === 1 ? { accountId: missing[0]!.accountId, name: missing[0]!.name, lastMovementOn: missing[0]!.lastMovementOn, balanceAtYearEndCents: missing[0]!.balanceAtYearEndCents } : null;
  const data = run.value.data as { warnings?: string[]; probe?: { differenceCents: number }; combineAllowed?: boolean };
  // Festgeschrieben: die Seiten der Fassung aus der Akte (Designer Runde 7, 16a C); ohne Inhalt keine Blätter (16a D).
  const finalVersion = run.value.finalVersion;
  const pages = run.value.empty ? null : finalVersion ? await versionPageCount(deps, ctx, finalVersion.reportId) : await reportPageCount(deps, ctx, key, reportParams);
  const projects = key === 'projectStatement' ? await projectChoices(deps, ctx, reportParams, run.value.data) : [];

  return (
    // Querformat braucht die Breite des Rahmens (Designer 2b: `full`); ein Hochformat in voller Breite wäre höher als
    // jeder Bildschirm, es steht in `standard`.
    <Page width={def.orientation === 'landscape' ? 'full' : 'standard'}>
      <ReportView
        reportKey={key}
        title={title}
        orientation={def.orientation}
        pageCount={pages?.ok ? pages.value : null}
        finalVersion={finalVersion}
        empty={run.value.empty}
        finalizable={run.value.finalizable}
        group={def.group}
        running={todayIn(deps) <= year.endsOn}
        back={{ href: `/finance/reports?year=${encodeURIComponent(year.id)}`, label: t('list.title') }}
        stage={run.value.stage}
        shortHash={run.value.shortHash}
        generatedAt={isoNow(deps.clock)}
        finalizeBlock={run.value.finalizeBlock}
        warnings={data.warnings ?? []}
        probeDifferenceCents={data.probe?.differenceCents ?? null}
        combineAllowed={data.combineAllowed === true}
        params={reportParams}
        years={years.map((y) => ({ id: y.id, designation: y.designation, calendarYear: y.endsOn.slice(0, 4) }))}
        yearKind={def.yearKind}
        year={{ id: year.id, designation: year.designation }}
        canFinalize={hasPermission(ctx, 'finance.reportsFinalize')}
        canRelease={hasPermission(ctx, 'finance.periodClose')}
        canOpenVersions={canRead}
        audit={audit}
        statementAccount={statementAccount}
        endsOn={year.endsOn}
        closingLink={canRead}
        projects={projects}
        periods={periods.map((p) => ({ id: p.id, label: p.label }))}
        periodId={bySpan ? period?.id : undefined}
        versions={versions.map((v) => ({ reportId: v.reportId, finalizedAt: v.finalizedAt, byName: names.get(v.byUserId) ?? t('list.system'), shortHash: v.shortHash, documentNumber: v.documentNumber, voidedAt: v.voidedAt, voidReason: v.voidReason }))}
      />
    </Page>
  );
}

/**
 * Die Projekte der Projektabrechnung zur Wahl: die Projekte mit Buchungen im Jahr (aus den Daten ohne Projektwahl),
 * benannt in der Leitsprache — nur mit `projects.view`, sonst bleibt „Alle Projekte“ (Entscheidung 9 des Plans).
 */
async function projectChoices(deps: Awaited<ReturnType<typeof requireSession>>['deps'], ctx: Awaited<ReturnType<typeof requireSession>>['ctx'], params: { fiscalYearId?: string; projectId?: string }, data: unknown): Promise<{ id: string; name: string }[]> {
  const named = await listProjects(deps, ctx);
  if (!named.ok) return [];
  const all = params.projectId ? await runFinanceReport(deps, ctx, { report: 'projectStatement', params: { fiscalYearId: params.fiscalYearId } }) : null;
  const ids = ((all?.ok ? all.value.data : data) as { projects: { projectId: string }[] }).projects.map((p) => p.projectId);
  if (params.projectId && !ids.includes(params.projectId)) ids.push(params.projectId);
  const leading = deps.locales()[0] ?? 'de';
  const names = new Map(named.value.map((p) => [p.id, (p.name as LocalizedText)[leading] || p.slug]));
  return ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! }));
}
