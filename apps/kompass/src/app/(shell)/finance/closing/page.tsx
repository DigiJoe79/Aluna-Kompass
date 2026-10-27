import { hasPermission, todayIn, userNamesFor } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { auditPackageRunStatus, getAssemblyResult, getClosingStatus, listFiscalYears, previewPeriodReopen } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { auditPackageView, type AuditPackageView } from '@/lib/finance/audit-package-view';
import { defaultClosingYearId } from '@/lib/finance/closing-year';
import { vatPeriodLabel, type VatPeriodTranslator } from '@/lib/finance/vat-period';
import { requireSession } from '@/lib/request-context';
import { ClosingHeader } from './closing-header';
import { ClosingSteps } from './closing-steps';
import type { ReopenPreview } from './reopen-dialog';
import type { AssemblyData } from './steps/assembly';
import { ClosingYearBar } from './year-bar';

/**
 * Jahresabschluss (Spec 0.4.0 § C, Board 3a–3c, 10a, 10c, 13b–13e): zwölf Schritte je Geschäftsjahr, das Jahr als
 * Rahmen. `task` (720, Designer). Lesen mit `finance.read` — Prüfer und Freigeber sehen Stand und Ergebnisse ohne
 * Knöpfe; bestätigen und abschließen mit `finance.periodClose`, die Amtsübergabe mit `finance.setup`.
 */
export default async function ClosingPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.closing');
  const tRoot = await getTranslations();
  const query = await searchParams;
  const yearsRes = await listFiscalYears(deps, ctx);
  const years = yearsRes.ok ? yearsRes.value : [];
  const yearId = years.some((y) => y.id === query.year)
    ? query.year!
    : await defaultClosingYearId(years, todayIn(deps), async (id) => {
        const s = await getClosingStatus(deps, ctx, { fiscalYearId: id });
        return s.ok && s.value.next === null;
      });
  if (!yearId) {
    return (
      <Page width="task" header={<PageHeader title={t('titleNoYear')} />}>
        <EmptyState title={t('noYear.title')} text={t('noYear.text')} />
      </Page>
    );
  }
  const statusRes = await getClosingStatus(deps, ctx, { fiscalYearId: yearId });
  if (!statusRes.ok) return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;
  const status = statusRes.value;

  let reopen: ReopenPreview | null = null;
  if (status.yearStatus === 'closed' && status.me.canClose) {
    const preview = await previewPeriodReopen(deps, ctx, { id: status.fiscalYearId });
    if (preview.ok) {
      const fmt = dateFormatOf(deps);
      // N14: die abgegebenen Umsatzsteuer-Erklärungen der Zeiträume des Jahres, Zeitraum und Tag schon lesbar.
      const vatFiled = preview.value.vatFiled.map((v) => ({ kind: v.kind, period: vatPeriodLabel(v.period, tRoot as VatPeriodTranslator), date: fmt.date(v.filedOn) }));
      reopen = { consequences: preview.value.consequences, laterYearClosed: preview.value.laterYearClosed, laterYear: preview.value.laterYear, taxReturnFiledOn: preview.value.taxReturnFiledOn ? fmt.date(preview.value.taxReturnFiledOn) : null, taxReturnPeriod: preview.value.taxReturnPeriod, vatFiled };
    }
  }
  const userIds = [...status.steps.map((s) => s.confirmation?.byUserId), status.reopened?.byUserId, ...status.steps.flatMap((s) => (s.facts.key === 'statements' ? s.facts.accounts.map((a) => a.confirmation?.byUserId) : []))];
  const names: Record<string, string> = Object.fromEntries(userNamesFor(deps, userIds));
  // Schritt 11: Vorstandsmitglieder des Jahres (Kontaktrollen) und das Protokoll; ihre Namen für den Ergebnissatz.
  const assembly: AssemblyData = { persons: [], minutes: null };
  if (status.yearStatus === 'closed') {
    const res = await getAssemblyResult(deps, ctx, { fiscalYearId: status.fiscalYearId });
    if (res.ok) {
      assembly.persons = res.value.persons;
      for (const p of res.value.persons) names[p.contactId] = p.name;
      const minutesId = res.value.result?.minutesDocumentId;
      if (minutesId) {
        const record = await getDocumentRecord(deps, ctx, minutesId);
        assembly.minutes = { id: minutesId, number: record.ok ? record.value.number : null, subject: record.ok ? record.value.subject : t('assembly.minutes'), phase: 'issued' };
      }
    }
  }
  let packageRun: AuditPackageView | null = null;
  if (status.next === 'auditPackage' && status.yearStatus === 'closed') {
    const run = await auditPackageRunStatus(deps, ctx, { fiscalYearId: status.fiscalYearId });
    if (run.ok) packageRun = auditPackageView(run.value, await getTranslations(), hasPermission(ctx, 'finance.periodClose'));
  }
  // Das Folgejahr: das früheste Jahr nach dem Stichtag (ohne Datumsrechnung).
  const nextDesignation = [...years].filter((y) => y.startsOn > status.endsOn).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0]?.designation;

  return (
    <Page width="task" header={<ClosingHeader status={status} reopen={reopen} handoverStart={{ today: todayIn(deps), canCreateContact: hasPermission(ctx, 'contacts.manage') }} />}>
      <div className="flex flex-col gap-4">
        <ClosingYearBar years={[...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn)).map((y) => ({ id: y.id, designation: y.designation }))} yearId={status.fiscalYearId} steps={status.steps.length} />
        <ClosingSteps status={status} names={names} canWrite={hasPermission(ctx, 'finance.entriesWrite')} packageRun={packageRun} nextDesignation={nextDesignation} assembly={assembly} today={todayIn(deps)} canFileVat={hasPermission(ctx, 'finance.periodClose')} />
      </div>
    </Page>
  );
}
