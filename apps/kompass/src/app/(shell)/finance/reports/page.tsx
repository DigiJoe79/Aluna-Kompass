import { hasPermission, todayIn, userNamesFor } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { dataExportRunStatus, getClosingStatus, listDataExports, listFinanceReports, listFiscalYears, listTaxPeriods } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { defaultClosingYearId } from '@/lib/finance/closing-year';
import { dataExportRunView, IDLE_DATA_EXPORT } from '@/lib/finance/data-export-view';
import { PERIOD_REPORTS } from '@/lib/finance/report-params';
import { requireSession } from '@/lib/request-context';
import { DataExportCard, type DataExportRow } from './data-export-card';
import { ReportList, type ReportListRow } from './report-list';
import { ReportsHeader, type HeaderRelease } from './reports-header';

/**
 * Berichte (Spec 0.4.0 § „Seite Berichte“, Board 2a, Designer Runde 2 11a): der Katalog je Geschäftsjahr, das Jahr als
 * Rahmen. Die Stufe steht einmal als Satz im Kopf, die Freigabe zum Festschreiben dauerhaft dort. `standard`: drei
 * Spalten, nicht `full` (Designer). Lesen mit `finance.overview` oder `finance.read`; der Katalog lässt ohne
 * `finance.read` die Berichte mit Personenbezug weg.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.overview')) return <Page width="standard"><ForbiddenCard permission="finance.overview" /></Page>;
  const t = await getTranslations('finance.reports');
  const yearsRes = await listFiscalYears(deps, ctx);
  const years = yearsRes.ok ? yearsRes.value : [];
  const query = await searchParams;
  const today = todayIn(deps);
  // Vorgabe wie im Jahresabschluss (292): das jüngste beendete Jahr, das nicht fertig ist.
  const yearId = years.some((y) => y.id === query.year)
    ? query.year!
    : await defaultClosingYearId(years, today, async (id) => {
        const s = await getClosingStatus(deps, ctx, { fiscalYearId: id });
        return s.ok && s.value.next === null;
      });
  const year = years.find((y) => y.id === yearId);
  if (!year) {
    return (
      <Page width="standard" header={<PageHeader title={t('list.title')} />}>
        <EmptyState title={t('list.noYear')} text={t('list.noYearText')} />
      </Page>
    );
  }

  const listed = await listFinanceReports(deps, ctx, { fiscalYearId: year.id });
  const { reports, release, releaseAudit, releaseChangeable, statementsMissing, followUp } = listed.ok ? listed.value : { reports: [], release: null, releaseAudit: null, releaseChangeable: true, statementsMissing: [], followUp: null };
  const fmt = dateFormatOf(deps);
  const newest = (r: (typeof reports)[number]) => r.lastFinal.find((v) => !v.voided) ?? null;
  const names = userNamesFor(deps, [...reports.flatMap((r) => r.lastFinal.map((v) => v.byUserId)), release?.byUserId]);
  // Ohne Nutzer (Seed, Agent über den Systemkontext) steht „Kompass“.
  const nameOf = (id: string) => names.get(id) ?? t('list.system');

  // Die Steuerberichte gelten je Erklärungszeitraum: der Zeitraum, zu dem das Jahr gehört (15i).
  const periodsRes = hasPermission(ctx, 'finance.read') ? await listTaxPeriods(deps, ctx, {}) : null;
  const period = (periodsRes?.ok ? periodsRes.value : []).find((p) => p.fiscalYearIds.includes(year.id)) ?? null;
  const periodOfYear = period?.id ?? null;
  const rows: ReportListRow[] = reports.map((r) => {
    const final = newest(r);
    // Ein Bericht je Erklärungszeitraum nennt den Zeitraum vorn — in jedem Jahr des Zeitraums dieselbe Zeile (239).
    const label = final ? t('list.finalBy', { date: fmt.date(final.finalizedAt), name: nameOf(final.byUserId) }) : null;
    return { key: r.key, group: r.group, available: r.available, finalLabel: label && period && PERIOD_REPORTS.includes(r.key) ? `${period.label} · ${label}` : label, periodId: periodOfYear };
  });
  const assemblyReports = reports.filter((r) => r.group === 'assembly' && r.available);

  const canRelease = hasPermission(ctx, 'finance.periodClose');
  let headerRelease: HeaderRelease | null = null;
  if (release) {
    // Der Scan erscheint im Dialog „Freigabe ändern …“ mit Nummer, wenn der Aufrufer die Akte lesen darf.
    const record = canRelease && release.documentId ? await getDocumentRecord(deps, ctx, release.documentId) : null;
    const document = release.documentId ? (record?.ok ? { id: release.documentId, number: record.value.number, subject: record.value.subject, phase: 'issued' as const } : { id: release.documentId, number: null, subject: t('release.scan'), phase: 'issued' as const }) : null;
    // Die Begründung ist frei getippt: nur an den, der die Freigabe ändern darf.
    headerRelease = { basis: release.basis, at: release.at, byName: nameOf(release.byUserId), auditReportFiledAt: releaseAudit?.reportFiledAt ?? null, followUpConfirmedAt: releaseAudit?.followUpConfirmedAt ?? null, ...(canRelease ? { note: release.note, document } : {}) };
  }

  // Datenexport (Board 13f): nur mit `finance.read` und `documents.export` — die Daten tragen Kontakte.
  let dataExport: { initial: Parameters<typeof DataExportCard>[0]['initial']; rows: DataExportRow[] } | null = null;
  if (hasPermission(ctx, 'finance.read') && hasPermission(ctx, 'documents.export')) {
    const [status, listedExports] = await Promise.all([dataExportRunStatus(deps, ctx, {}), listDataExports(deps, ctx, {})]);
    const exports = listedExports.ok ? listedExports.value.exports : [];
    const exportNames = userNamesFor(deps, exports.map((e) => e.byUserId));
    dataExport = {
      initial: status.ok ? dataExportRunView(status.value, await getTranslations()) : IDLE_DATA_EXPORT,
      rows: exports.map((e) => ({ id: e.id, createdAt: e.createdAt, designations: e.designations, provisional: e.provisional, byName: e.byUserId ? (exportNames.get(e.byUserId) ?? null) : null, sizeBytes: e.sizeBytes })),
    };
  }
  const exportYears = [...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn)).map((y) => ({ id: y.id, designation: y.designation, closed: y.status !== 'open' }));

  return (
    <Page
      width="standard"
      header={
        <ReportsHeader
          year={{ id: year.id, designation: year.designation, status: year.status === 'open' ? 'open' : 'closed' }}
          release={headerRelease}
          releaseChangeable={releaseChangeable}
          assembly={{ done: assemblyReports.filter((r) => newest(r)).length, total: assemblyReports.length }}
          canRelease={canRelease}
          statementsMissing={statementsMissing}
          endsOn={year.endsOn}
          closingLink={hasPermission(ctx, 'finance.read')}
          followUp={followUp}
          ended={today > year.endsOn}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <ReportList rows={rows} years={[...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn)).map((y) => ({ id: y.id, designation: y.designation }))} yearId={year.id} />
        {dataExport ? <DataExportCard initial={dataExport.initial} rows={dataExport.rows} years={exportYears} /> : null}
      </div>
    </Page>
  );
}
