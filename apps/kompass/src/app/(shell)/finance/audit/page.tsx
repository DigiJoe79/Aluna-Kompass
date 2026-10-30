import { hasPermission } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { auditorCandidates, auditPackageRunStatus, getAssemblyResult, getAuditReport, getAuditSection, getAuditStatus, listAuditRemarks, listAuditors, type AuditReportView, type AuditSection, type AuditSectionRow } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import type { AuditorCandidateView } from './auditor-dialog';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { auditHead } from '@/lib/finance/audit-overview';
import { auditPackageView } from '@/lib/finance/audit-package-view';
import { summarizeSection, type SectionSummary } from '@/lib/finance/audit-package';
import { resolveAuditYear } from '@/lib/finance/audit-year';
import { financeLandingPath } from '@/lib/finance/landing';
import { remarkViews } from '@/lib/finance/audit-remarks';
import { readAllPages } from '@/lib/read-all-pages';
import { requireSession } from '@/lib/request-context';
import { AuditHeader } from './audit-header';
import { AuditorsSection } from './auditors-section';
import { PackageSection } from './package-section';
import { RemarksSection } from './remarks-section';
import { ReportSection, type ReportLine, type ReportSectionData } from './report-section';
import { AuditYearBar } from './year-bar';

/**
 * Kassenprüfung (Spec 0.4.0 § D1, Board 4a/4e, Runde 3 12a–12c): eine Übersicht je Geschäftsjahr. Wer für das Jahr
 * „in Kompass“ prüft (`status.me.auditorId`), sieht die Prüferansicht; alle anderen mit Leserecht die der
 * Schatzmeisterin mit dem Abschnitt „Prüfer“. `standard` (Board). Lesen mit `finance.read` oder `finance.audit`.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.audit')) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.audit');
  const query = await searchParams;
  const { years, mine, year } = await resolveAuditYear(deps, ctx, query.year);
  const auditorOnly = financeLandingPath(ctx.permissions) === '/finance/audit';

  // Wer nur prüft und für kein Jahr eingetragen ist, landet auf der Zustandskarte (Board 12c).
  if (auditorOnly && mine.length === 0) {
    return (
      <Page width="standard">
        <EmptyState state={{ title: t('notAuditor.title'), text: t('notAuditor.text') }} />
      </Page>
    );
  }
  if (!year) {
    return (
      <Page width="standard" header={<PageHeader title={t('titleNoYear')} />}>
        <EmptyState title={t('noYear.title')} text={t('noYear.text')} />
      </Page>
    );
  }

  const statusRes = await getAuditStatus(deps, ctx, { fiscalYearId: year.id });
  if (!statusRes.ok) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const status = statusRes.value;
  const auditorsRes = await listAuditors(deps, ctx, { fiscalYearId: year.id });
  const auditors = auditorsRes.ok ? auditorsRes.value.auditors : [];
  const latest = await getAuditReport(deps, ctx, { fiscalYearId: year.id });
  const latestReport = latest.ok ? latest.value : null;
  // „seit der Prüffassung vom …“ zählt gegen den Prüfstand des zuletzt abgelegten Berichts.
  const filedReport = latestReport?.state === 'filed' ? latestReport : await (async () => {
    const first = await getAuditReport(deps, ctx, { fiscalYearId: year.id, kind: 'report' });
    return first.ok && first.value?.state === 'filed' ? first.value : null;
  })();
  const head = auditHead(status, auditors.length, { referenceAt: filedReport?.subject.baseline.createdAt ?? null, filedAt: filedReport?.filedAt ?? null });

  const myAuditorId = status.me.auditorId;
  const auditorView = myAuditorId ? { coAuditors: auditors.filter((a) => a.id !== myAuditorId).map((a) => ({ name: a.contactName, paper: a.mode === 'paper' })) } : null;
  const canManage = hasPermission(ctx, 'finance.periodClose');

  const remarksRes = await listAuditRemarks(deps, ctx, { fiscalYearId: year.id });
  // Fortschritt je Abschnitt: alle Zeilen über `readAllPages`; das Journal zählt nur Stichproben und Vermerke.
  const sections: SectionSummary[] = [];
  if (status.yearStatus === 'closed' && status.baseline) {
    // Designer Runde 8, 281: nur Vermerke an Buchungen, nach Zustand (offen, beantwortet) — aus dem Dienst.
    const onEntries = remarksRes.ok ? remarksRes.value.remarksOnEntries : { open: 0, answered: 0 };
    const readAll = async (section: AuditSection): Promise<AuditSectionRow[]> => {
      const rows = await readAllPages((page) => getAuditSection(deps, ctx, { fiscalYearId: year.id, section, ...page }), (v) => v.rows);
      return rows.ok ? rows.value : [];
    };
    const names = new Map(auditors.map((a) => [a.id, a.contactName]));
    const followUp = status.followUpOpen || status.report?.kind === 'followUp';
    for (const section of status.sections) {
      const summary = section === 'journal' ? { ...summarizeSection('journal', [], { samples: status.samples.sampledEntries }), remarksOpen: onEntries.open, remarksAnswered: onEntries.answered } : summarizeSection(section, await readAll(section), { samples: 0 });
      const reviewers = status.sectionsReviewed.find((r) => r.section === section)?.auditorIds ?? [];
      // „durchgesehen vor der Nachprüfung“ nur, wenn es eine Nachprüfung gibt (Befund 7).
      const before = followUp ? status.sectionsReviewedBefore.find((r) => r.section === section) : undefined;
      sections.push({ section, ...summary, reviewedBy: reviewers.map((id) => names.get(id) ?? '').filter(Boolean), reviewedByMe: myAuditorId !== null && reviewers.includes(myAuditorId), reviewedBefore: before ? { names: before.auditorIds.map((id) => names.get(id) ?? '').filter(Boolean), at: before.at } : null });
    }
  }

  const remarks = remarksRes.ok ? remarksRes.value.remarks : [];
  const views = await remarkViews(deps, ctx, remarks, { auditors, fiscalYearId: year.id, designation: year.designation });
  const yearItems = views.items.filter((_, i) => remarks[i]!.target.type === 'year');
  const me = myAuditorId ? (auditors.find((a) => a.id === myAuditorId)?.contactName ?? '') : '';
  const paperAuditors = auditors.filter((a) => a.mode === 'paper').map((a) => ({ id: a.id, name: a.contactName }));
  const yearRemark = myAuditorId && status.yearStatus === 'closed' ? { fiscalYearId: year.id, target: { type: 'year' as const, id: year.id, label: t('remarks.target.year', { year: year.designation }) }, me, paperAuditors, treasurerName: auditorsRes.ok ? auditorsRes.value.treasurerName : null } : null;

  // Abschnitt „Prüfbericht“ (Board 4e, 12e): Bericht und Nachtrag, Scan, Vordruck, Prüfpaket.
  const [mainRes, followRes] = await Promise.all([getAuditReport(deps, ctx, { fiscalYearId: year.id, kind: 'report' }), getAuditReport(deps, ctx, { fiscalYearId: year.id, kind: 'followUp' })]);
  const reportViews = [mainRes.ok ? mainRes.value : null, followRes.ok ? followRes.value : null].filter((r): r is AuditReportView => r !== null);
  const lines: ReportLine[] = [];
  for (const r of reportViews) {
    const docs = [];
    for (const scan of r.scans) {
      const record = await getDocumentRecord(deps, ctx, scan.documentId);
      docs.push({ id: scan.documentId, number: record.ok ? record.value.number : null });
    }
    lines.push({ kind: r.kind, state: r.state, origin: r.origin, editorNames: r.editorNames, lastEditedAt: r.lastEditedAt, lastPrintedAt: r.lastPrintedAt, readyAt: r.readyAt, filedAt: r.filedAt, scansFiled: r.scans.length, scansExpected: r.scansExpected, documents: docs, href: `/finance/audit/report?year=${encodeURIComponent(year.id)}${r.kind === 'followUp' ? '&kind=followUp' : ''}` });
  }
  const ready = reportViews.find((r) => r.state === 'readyToSign') ?? null;
  const onlyPaper = auditors.length > 0 && auditors.every((a) => a.mode === 'paper');
  const closed = status.yearStatus === 'closed';
  const pendingKind = status.followUpOpen ? 'followUp' : 'report';
  const hasPending = reportViews.some((r) => r.kind === pendingKind && r.state !== 'filed');
  const scanTarget = ready ? { reportId: ready.id } : onlyPaper && closed && canManage && !hasPending && head.kind !== 'done' ? { fiscalYearId: year.id } : null;
  const scanAuditors = ready && ready.signatures.mode === 'separate' ? ready.auditors.filter((a) => !ready.scans.some((s) => s.auditorId === a.id)).map((a) => ({ id: a.id, name: a.contactName })) : [];
  const run = closed && status.baseline ? await auditPackageRunStatus(deps, ctx, { fiscalYearId: year.id }) : null;
  const reportSection: ReportSectionData = {
    yearId: year.id,
    designation: year.designation,
    auditorView: myAuditorId !== null,
    canManage,
    canFile: canManage || status.me.canEditReport,
    cash: { done: status.cashCount !== null, keepers: status.cashKeepers },
    remarksOpen: status.remarksUnresolved,
    reviewed: status.sectionsReviewed.length,
    total: status.sections.length,
    lines,
    scanTarget,
    scanAuditors,
    onlyPaper: onlyPaper && closed && head.kind !== 'done',
    followUpOpen: status.followUpOpen,
    followUpUnchanged: status.followUpOpen && status.changedEntryIds.length === 0,
    followUpHref: status.followUpOpen && !reportViews.some((r) => r.kind === 'followUp') && status.me.canEditReport ? `/finance/audit/report?year=${encodeURIComponent(year.id)}&kind=followUp` : null,
    writeDraft: closed && status.me.canEditReport && !status.followUpOpen && !reportViews.some((r) => r.kind === 'report'),
    packageRun: run?.ok ? auditPackageView(run.value, await getTranslations(), hasPermission(ctx, 'finance.periodClose')) : null,
  };

  const assemblyRes = closed ? await getAssemblyResult(deps, ctx, { fiscalYearId: year.id }) : null;
  const assemblyOn = assemblyRes?.ok ? (assemblyRes.value.result?.assemblyOn ?? null) : null;

  const documents: Record<string, PickedDocument> = {};
  if (canManage) {
    for (const id of new Set(auditors.flatMap((a) => [a.confidentialityDocumentId, a.minutesDocumentId]).filter((d): d is string => Boolean(d)))) {
      const record = await getDocumentRecord(deps, ctx, id);
      documents[id] = record.ok ? { id, number: record.value.number, subject: record.value.subject, phase: 'issued' } : { id, number: null, subject: t('auditorDialog.declaration'), phase: 'issued' };
    }
  }
  // In Gremien gewählte Kassenprüfer als Vorschlag für „Prüfer eintragen“ (G7); ohne Gremien leer.
  const candidates: AuditorCandidateView[] = [];
  if (canManage) {
    const found = await auditorCandidates(deps, ctx, { fiscalYearId: year.id });
    for (const c of found.ok ? found.value : []) {
      const record = c.minutesDocumentId ? await getDocumentRecord(deps, ctx, c.minutesDocumentId) : null;
      const minutesDocument = record?.ok && c.minutesDocumentId ? { id: c.minutesDocumentId, number: record.value.number, subject: record.value.subject, phase: 'issued' as const } : null;
      candidates.push({ contactId: c.contactId, name: c.name, electedOn: c.electedOn, minutesDocument, source: c.source });
    }
  }

  return (
    <Page width="standard" header={<AuditHeader designation={year.designation} head={head} auditorView={auditorView} canManage={canManage} yearRemark={yearRemark} />}>
      <div className="flex flex-col gap-4">
        <AuditYearBar years={[...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn)).map((y) => ({ id: y.id, designation: y.designation }))} yearId={year.id} sections={status.sections.length} />
        {auditorView ? null : (
          <AuditorsSection
            year={{ id: year.id, designation: year.designation, closed: status.yearStatus === 'closed' }}
            auditors={auditors}
            documents={documents}
            candidates={candidates}
            canManage={canManage}
            canManageUsers={hasPermission(ctx, 'users.manage')}
            canCreateContact={hasPermission(ctx, 'contacts.manage')}
            filedAt={head.kind === 'done' ? (filedReport?.filedAt ?? null) : null}
            assemblyOn={assemblyOn}
            packageFiles={status.packageRun?.files ?? []}
            packageRunning={status.packageRun?.state === 'running'}
          />
        )}
        <PackageSection yearId={year.id} sections={sections} auditorView={auditorView !== null} auditDone={status.workFixedSince !== null} treasurerName={auditorsRes.ok ? auditorsRes.value.treasurerName : null} />
        <RemarksSection rows={views.rows} yearItems={yearItems} canAnswer={hasPermission(ctx, 'finance.entriesWrite')} canAudit={myAuditorId !== null} />
        {closed && auditors.length > 0 ? <ReportSection data={reportSection} /> : null}
      </div>
    </Page>
  );
}
