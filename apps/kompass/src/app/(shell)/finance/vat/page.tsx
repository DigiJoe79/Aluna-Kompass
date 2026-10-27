import { hasPermission, isoNow, todayIn } from '@kompass/core';
import { listVatPeriodsWithPayments, runFinanceReport, vatProfileAt, type VatAdvanceReturnData, type VatPeriodWithPayment } from '@kompass/module-finance';
import { vatFormFor, vatFormNotes } from '@kompass/module-finance/vat-forms';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { toActionState } from '@/lib/actions';
import { reportQuery } from '@/lib/finance/report-params';
import { vatFigureRows } from '@/lib/finance/vat-figures';
import { vatPeriodLabel } from '@/lib/finance/vat-period';
import { requireSession } from '@/lib/request-context';
import { VatFiguresTable } from './vat-figures-table';
import { VatFilingCard } from './vat-filing-card';
import { VatHeader, VatPeriodBar } from './vat-header';

/**
 * Umsatzsteuer-Voranmeldung (Plan E6b Task 8, Board 8a/8b): je Zeitraum die Werte zum Übertragen in ELSTER nach
 * Kennzahlen, Abgabe und Berichtigung. Lesen mit `finance.read` — immer erreichbar, auch ohne Unternehmer, weil § 18
 * Abs. 4a UStG jeden Verein trifft und die Fristen hierher verlinken. Die Werte rechnet der Bericht `vatAdvanceReturn`,
 * Frist, Abgaben, Berichtigung und Nachzahlung `listVatPeriodsWithPayments`; die Seite ordnet nur an.
 */
export default async function VatPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations();
  const query = await searchParams;
  const today = todayIn(deps);
  const year = Number(today.slice(0, 4));
  const label = (key: string) => vatPeriodLabel(key, t as never);

  // Begonnene Zeiträume des Jahres und des Vorjahres mit Pflicht oder Abgabe, neueste zuerst.
  const views: VatPeriodWithPayment[] = [];
  for (const y of [year, year - 1]) {
    const listed = await listVatPeriodsWithPayments(deps, ctx, { year: y });
    if (listed.ok) views.push(...listed.value.advance.filter((p) => p.required || p.filings.length > 0));
  }
  views.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  if (views.length === 0) {
    return (
      <Page width="standard">
        <PageHeader title={t('finance.vat.titlePlain')} />
        <EmptyState title={t('finance.vat.empty.title')} text={t('finance.vat.empty.text')} />
      </Page>
    );
  }
  // Vorgabe: der älteste offene Zeitraum (ohne Abgabe oder mit offener Berichtigung), sonst der neueste.
  const open = [...views].reverse().find((p) => (p.required && p.filings.length === 0) || p.amendmentDue);
  const view = views.find((p) => p.key === query.period) ?? open ?? views[0]!;
  const periodLabel = label(view.key);
  const bar = (count: number) => <VatPeriodBar options={views.map((p) => ({ key: p.key, label: label(p.key) }))} period={view.key} count={count} />;

  const run = await runFinanceReport(deps, ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: view.key } });
  if (!run.ok) {
    const state = toActionState(run, t);
    return (
      <Page width="standard">
        <PageHeader title={t('finance.vat.title', { period: periodLabel })} />
        <div className="flex flex-col gap-5">
          {bar(0)}
          <Notice level="refuse">{state.status === 'error' ? state.message : ''}</Notice>
        </div>
      </Page>
    );
  }
  const data = run.value.data as VatAdvanceReturnData;
  const lastFiling = view.filings.at(-1) ?? null;
  const rows = vatFigureRows({ formYear: data.formYear, taxation: data.taxation, values: data.values, filed: lastFiling?.figures ?? null, amendment: view.amendmentDue });
  const cause = view.amendmentCause;
  const kind = view.kind === 'month' ? 'month' : 'quarter';

  return (
    <Page width="standard">
      <VatHeader
        periodKey={view.key}
        periodLabel={periodLabel}
        stage={run.value.stage}
        amendmentDue={view.amendmentDue}
        dueOn={view.dueOn}
        filedOn={lastFiling?.filedOn ?? null}
        shortHash={run.value.shortHash}
        generatedAt={isoNow(deps.clock)}
        finalVersion={run.value.finalVersion}
        today={today}
        finalizeBlock={run.value.finalizeBlock}
        canFinalize={hasPermission(ctx, 'finance.reportsFinalize')}
        pdfHref={`/finance/reports/vatAdvanceReturn/preview?${reportQuery({ vatPeriod: view.key })}`}
      />
      <div className="flex flex-col gap-5">
        {bar(rows.length)}
        {view.amendmentDue ? (
          <Notice level="warn" testId="vat-amendment">
            {cause && cause.entryNumber
              ? t.rich('finance.vat.amendment.cause', {
                  entryNumber: cause.entryNumber,
                  change: cause.change,
                  // Die Buchungsnummer führt zur Buchung (Designer Runde 8, 345).
                  entry: (chunks) => (
                    <Link href={`/finance/entries/${cause.entryId}`} className="font-mono text-link underline-offset-2 hover:underline">
                      {chunks}
                    </Link>
                  ),
                })
              : t('finance.vat.amendment.noCause')}
          </Notice>
        ) : null}
        <VatFilingCard
          periodKey={view.key}
          periodLabel={periodLabel}
          dueOn={view.dueOn}
          kind={kind}
          permanentExtension={vatProfileAt(deps.db, view.endsOn).permanentExtension}
          resultCents={data.values.find((v) => v.source === 'result')?.cents ?? 0}
          lastFiling={lastFiling}
          amendmentDue={view.amendmentDue}
          amendmentPayment={view.amendmentPayment}
          finalized={run.value.stage === 'final'}
          canEdit={hasPermission(ctx, 'finance.periodClose')}
          canPickDocument={hasPermission(ctx, 'dms.view')}
          today={today}
        />
        <VatFiguresTable rows={rows} amendment={view.amendmentDue} filedMissing={view.amendmentDue && lastFiling !== null && lastFiling.figures === null} notes={vatFormNotes(vatFormFor('advance', data.formYear), data.taxation)} />
      </div>
    </Page>
  );
}
