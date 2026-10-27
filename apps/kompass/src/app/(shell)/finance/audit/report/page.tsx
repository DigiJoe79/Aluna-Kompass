import { hasPermission, readSetting, userNamesFor } from '@kompass/core';
import { getAuditReport, getAuditStatus, listAuditRemarks, listAuditors } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { PdfPages } from '@/components/pdf-pages';
import { Disclosure } from '@/components/ui/disclosure';
import { dateFormatOf } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { remarkViews } from '@/lib/finance/audit-remarks';
import { documentPageCount } from '@/lib/finance/report-pages';
import { resolveAuditYear } from '@/lib/finance/audit-year';
import { requireSession } from '@/lib/request-context';
import { CreateDraftButton } from './create-draft-button';
import { ExaminationCard } from './examination-card';
import { FindingsBlock } from './findings-block';
import { UnsavedCardsProvider } from './unsaved-cards';
import { ReportHeader } from './report-header';
import { ResultCards } from './result-card';
import { SignaturesCard } from './signatures-card';
import { SubjectBlock } from './subject-block';

/**
 * Seite „Prüfbericht“ (Board 12d, 12e C): ein Formular in Druckreihenfolge, eine Spalte (`task`), keine Vorschau
 * daneben. Kompass-Teile als Text mit Link, Prüfer-Teile als Karten, die je für sich speichern. `?kind=followUp` ist der
 * Nachtrag nach dem Wiederöffnen. Ohne Bearbeitungsrecht steht alles als Text.
 */
export default async function AuditReportPage({ searchParams }: { searchParams: Promise<{ year?: string; kind?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.audit')) return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.audit.report');
  const query = await searchParams;
  const kind = query.kind === 'followUp' ? 'followUp' : 'report';
  const { year } = await resolveAuditYear(deps, ctx, query.year);
  if (!year) notFound();
  const back = { href: `/finance/audit?year=${encodeURIComponent(year.id)}`, label: t('back', { year: year.designation }) };
  const title = kind === 'followUp' ? t('titleFollowUp', { year: year.designation }) : t('title', { year: year.designation });

  const [reportRes, statusRes, auditorsRes] = await Promise.all([getAuditReport(deps, ctx, { fiscalYearId: year.id, kind }), getAuditStatus(deps, ctx, { fiscalYearId: year.id }), listAuditors(deps, ctx, { fiscalYearId: year.id })]);
  if (!statusRes.ok) return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;
  const report = reportRes.ok ? reportRes.value : null;
  if (!report) {
    const canCreate = statusRes.value.me.canEditReport && statusRes.value.yearStatus === 'closed';
    return (
      <Page width="task" header={<PageHeader title={title} back={back} />}>
        <EmptyState title={t('missing.title')} text={canCreate ? t('missing.textEditor') : t('missing.text', { year: year.designation })} action={canCreate ? <CreateDraftButton fiscalYearId={year.id} kind={kind} /> : undefined} />
      </Page>
    );
  }

  const auditors = auditorsRes.ok ? auditorsRes.value.auditors : [];
  const fmt = dateFormatOf(deps);
  const userIds = [report.examination.updatedByUserId, report.signatures.updatedByUserId, ...report.results.map((r) => r.updatedByUserId)];
  const names = Object.fromEntries(userNamesFor(deps, userIds));
  const remarksRes = await listAuditRemarks(deps, ctx, { fiscalYearId: year.id });
  const all = remarksRes.ok ? remarksRes.value.remarks : [];
  const views = await remarkViews(deps, ctx, all, { auditors, fiscalYearId: year.id, designation: year.designation });
  const line = (id: string, text: string) => ({ id, text, href: views.rows.find((r) => r.id === id)?.targetHref ?? null });
  const witnessNames = (report.subject.cash?.witnessAuditorIds ?? []).map((id) => auditors.find((a) => a.id === id)?.contactName ?? '').filter(Boolean);
  // Die Zählungen, die der Bericht zeigen kann (nach seinem Prüfstand) — beim Nachtrag nicht die der Erstprüfung.
  const cashCounts = report.cashCounts.map((c) => ({ id: c.countId, label: t('exam.cashCountOption', { amount: formatEuro(c.countedCents), date: fmt.date(c.countedOn) }) }));
  const canEdit = report.canEdit;
  const canPrint = hasPermission(ctx, 'finance.periodClose') || statusRes.value.me.canEditReport;
  // Abgelegt gilt der unterschriebene Scan (Designer Runde 7, 16e): er steht als Seiten oben, die Angaben klappen zu.
  const filedScans = report.state === 'filed' ? await Promise.all(report.scans.map(async (scan) => ({ documentId: scan.documentId, pages: await documentPageCount(deps, ctx, scan.documentId) }))) : [];
  const cards = (
    <>
      <SubjectBlock report={report} organization={readSetting<string>(deps, 'organization.name') ?? ''} yearId={year.id} witnessNames={witnessNames} />
      <ExaminationCard report={report} canEdit={canEdit} names={names} cashCounts={cashCounts} />
      <FindingsBlock findings={report.findings.map((f) => line(f.id, f.text))} openQuestions={report.openQuestions.map((f) => line(f.id, f.text))} filed={report.state === 'filed'} />
      <ResultCards report={report} canEdit={canEdit} names={names} />
      <SignaturesCard report={report} canEdit={canEdit} names={names} />
    </>
  );

  // Kein `key` an den Karten: Ein neuer Stand vom Server (anderer Prüfer, eigenes Speichern) lässt die Eingaben stehen;
  // jede Karte vergleicht mit ihren Props und schickt deren Version (Konflikt je Karte).
  return (
    <UnsavedCardsProvider>
      <Page width="task" header={<ReportHeader report={report} yearId={year.id} designation={year.designation} canPrint={canPrint} />}>
        {filedScans.length > 0 ? (
          <div className="flex flex-col gap-4">
            {filedScans.map((scan) => (
              <PdfPages key={scan.documentId} title={title} pageCount={scan.pages.ok ? scan.pages.value : null} pageSrc={(page, scale) => `/dms/${encodeURIComponent(scan.documentId)}/page/${page}${scale === 2 ? '?scale=2' : ''}`} pdfHref={`/dms/${encodeURIComponent(scan.documentId)}/file`} orientation="portrait" />
            ))}
            <Disclosure label={t('details')} bounded={false}>
              <div className="flex flex-col gap-4 pt-1" data-testid="audit-report-details">
                {cards}
              </div>
            </Disclosure>
          </div>
        ) : (
          <div className="flex flex-col gap-4">{cards}</div>
        )}
      </Page>
    </UnsavedCardsProvider>
  );
}
