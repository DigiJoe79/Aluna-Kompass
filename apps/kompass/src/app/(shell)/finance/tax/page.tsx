import { hasPermission, isModuleEnabled, isoNow, todayIn, type CallContext, type Deps } from '@kompass/core';
import {
  getTaxReturn,
  listCategories,
  listFinanceLines,
  listFiscalYears,
  listNotices,
  listReserves,
  listTaxPeriods,
  reportDefinition,
  suggestedDueOn,
  taxPeriodDefaults,
  type GemLineValue,
  type TaxReturnGemReport,
} from '@kompass/module-finance';
import { countMembersAt } from '@kompass/module-members';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { reportQuery } from '@/lib/finance/report-params';
import { readAllPages } from '@/lib/read-all-pages';
import { requireSession } from '@/lib/request-context';
import { AnswersCard } from './answers-card';
import { AttachmentsList } from './attachments-list';
import { FilingSection, RetractedNotice, type TaxNotice } from './filing-section';
import { GemHints, GemValuesTable } from './gem-values-table';
import { TaxEmpty, TaxHeader, TaxPeriodBar } from './tax-header';
import { choosePeriod, type DueSuggestions, type TaxMe, type TaxPeriodOption, type TaxYear } from './types';

/**
 * Steuererklärung (Rechenschaft D2; Board 5a, 10b, 13g, 15d–15f): ein Erklärungszeitraum mit Abgabe, „Ihre Angaben“, den
 * Werten der Anlage Gem zum Übertragen in ELSTER, Hinweisen und Beilagen. Lesen mit `finance.read`, pflegen mit
 * `finance.periodClose`; die Werte rechnet der Bericht `taxReturnGem` (`getTaxReturn`), die Seite ordnet nur an.
 */
export default async function TaxPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const query = await searchParams;
  const [periodsRes, yearsRes, defaultsRes] = await Promise.all([listTaxPeriods(deps, ctx, {}), listFiscalYears(deps, ctx), taxPeriodDefaults(deps, ctx, {})]);
  const periods = periodsRes.ok ? periodsRes.value : [];
  const years: TaxYear[] = (yearsRes.ok ? yearsRes.value : []).map((y) => ({ id: y.id, designation: y.designation, startsOn: y.startsOn, endsOn: y.endsOn })).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const dueSuggestions: DueSuggestions = Object.fromEntries(years.map((y) => [y.id, { plain: suggestedDueOn(y.endsOn, false), advisor: suggestedDueOn(y.endsOn, true) }]));
  const defaults = defaultsRes.ok && defaultsRes.value ? { firstFiscalYearId: defaultsRes.value.firstFiscalYearId, lastFiscalYearId: defaultsRes.value.lastFiscalYearId } : null;
  const me: TaxMe = {
    canEdit: hasPermission(ctx, 'finance.periodClose'),
    canFinalize: hasPermission(ctx, 'finance.reportsFinalize'),
    canWriteEntries: hasPermission(ctx, 'finance.entriesWrite'),
    canPickDocument: hasPermission(ctx, 'dms.view'),
  };
  const dialog = { years, defaults, latestPeriod: periods[0]?.label ?? null, dueSuggestions };

  if (periods.length === 0) {
    return (
      <Page width="standard">
        <TaxEmpty me={me} {...dialog} />
      </Page>
    );
  }

  // Vorgabe: der neueste offene Zeitraum, sonst der neueste (13g).
  const chosen = choosePeriod(periods, query.period)!;
  const viewRes = await getTaxReturn(deps, ctx, { taxPeriodId: chosen.id });
  if (!viewRes.ok) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const view = viewRes.value;
  const data = view.run.data as TaxReturnGemReport;

  const noticesRes = await listNotices(deps, ctx, { includeInactive: true });
  const notices = noticesRes.ok ? noticesRes.value : [];
  const noticeOf = (id: string | null) => (id ? notices.find((n) => n.id === id && n.state !== 'voided') : undefined);
  const options: TaxPeriodOption[] = periods.map((p) => ({ id: p.id, label: p.label, state: p.state, dueOn: p.dueOn, filedOn: p.filedOn, noticeOn: noticeOf(p.noticeId)?.noticeDate ?? null }));
  const notice = noticeOf(view.period.noticeId);
  const taxNotice: TaxNotice | null = notice ? { id: notice.id, noticeDate: notice.noticeDate, documentId: notice.documentId, documentNumber: notice.documentNumber } : null;

  const [categoriesRes, reservesRes] = await Promise.all([listCategories(deps, ctx, {}), listReserves(deps, ctx, {})]);
  const names = {
    categories: Object.fromEntries((categoriesRes.ok ? categoriesRes.value : []).map((c) => [c.id, c.name])),
    reserves: Object.fromEntries((reservesRes.ok ? reservesRes.value : []).map((r) => [r.id, r.name])),
  };
  const reservesOf = (line: string) => {
    const value = data.lines.find((l) => l.line === line)?.value;
    return value?.kind === 'list' ? value.rows.map((r) => ({ id: String(r.reserveId), name: names.reserves[String(r.reserveId)] ?? '' })) : [];
  };
  const periodYears = years.filter((y) => view.period.fiscalYearIds.includes(y.id));
  const lastYear = periodYears.at(-1) ?? null;

  return (
    <Page width="full">
      <TaxHeader
        period={view.period}
        stage={view.run.stage}
        shortHash={view.run.shortHash}
        generatedAt={isoNow(deps.clock)}
        finalizeBlock={view.run.finalizeBlock}
        missingCount={data.missingCount}
        me={{ ...me, canFinalize: view.me.canFinalize }}
        pdfHref={`/finance/reports/taxReturnGem/preview?${reportQuery({ taxPeriodId: view.period.id })}`}
        runningYear={lastYear && todayIn(deps) <= lastYear.endsOn ? lastYear.designation : null}
        {...dialog}
      />
      <div className="flex flex-col gap-5">
        <TaxPeriodBar periods={options} periodId={view.period.id} lineCount={data.lines.length} />
        {view.retracted ? <RetractedNotice retracted={view.retracted} periodId={view.period.id} /> : null}
        <FilingSection period={view.period} notice={taxNotice} me={me} finalized={view.run.stage === 'final'} />
        <AnswersCard
          key={view.period.id}
          period={{ id: view.period.id, version: view.period.version, answers: view.period.answers }}
          formYear={data.formYear}
          years={periodYears}
          replacementReserves={reservesOf('54')}
          participationReserves={reservesOf('59')}
          memberSuggestions={await memberSuggestions(deps, ctx, periodYears)}
          canEdit={view.me.canEdit}
          filed={view.period.filedOn !== null}
          today={todayIn(deps)}
        />
        <GemValuesTable data={data} names={names} originHrefs={await originHrefs(deps, ctx, data)} canWriteEntries={me.canWriteEntries} />
        <GemHints hints={data.hints} />
        <AttachmentsList attachments={view.attachments} periodId={view.period.id} periodLabel={view.period.label} designations={Object.fromEntries(years.map((y) => [y.id, y.designation]))} documents={view.period.documents} me={{ ...me, canEdit: view.me.canEdit }} />
      </div>
    </Page>
  );
}

/** Mitglieder am Ende jedes Jahres laut Mitgliederverwaltung — nur, wenn sie an ist und gelesen werden darf (Board 15e). */
async function memberSuggestions(deps: Deps, ctx: CallContext, years: readonly TaxYear[]): Promise<Record<string, number> | null> {
  if (!isModuleEnabled(deps, 'members') || !hasPermission(ctx, 'members.read')) return null;
  const out: Record<string, number> = {};
  for (const y of years) {
    const count = await countMembersAt(deps, ctx, { date: y.endsOn });
    if (count.ok) out[y.id] = count.value.total;
  }
  return out;
}

/**
 * Das Ziel der Herkunft je Zeile (Board 5a: „ein Link ins gefilterte Journal statt einer Aufklappung“): Buchungen über
 * die Filter des Berichts (`linesFilter`) als Belegliste im Journal, Berichte mit ihren Parametern, Angaben als Feld oben.
 */
async function originHrefs(deps: Deps, ctx: CallContext, data: TaxReturnGemReport): Promise<Record<string, string | null>> {
  const filters = reportDefinition('taxReturnGem')?.linesFilter?.(data, { taxPeriodId: data.taxPeriodId }) ?? {};
  const entryIds = new Map<string, string[]>();
  for (const [key, filter] of Object.entries(filters)) {
    const lines = await readAllPages((page) => listFinanceLines(deps, ctx, { ...filter, ...page }), (v) => v.lines);
    entryIds.set(key, lines.ok ? [...new Set(lines.value.map((l) => l.entryId))] : []);
  }
  const hrefOf = (v: GemLineValue): string | null => {
    const o = v.origin;
    if (!o) return null;
    switch (o.kind) {
      case 'lines': {
        const ids = entryIds.get(o.filterKey) ?? [];
        return ids.length > 0 ? `/finance/entries?ids=${ids.join(',')}` : null;
      }
      case 'report': {
        // Über die Jahre des Zeitraums (Rücklagenspiegel) mit `?period=` wie die Beilage (Befund 18 d).
        return `/finance/reports/${o.report}?${reportQuery(o.params, { periodId: data.taxPeriodId })}`;
      }
      case 'answer':
        return `#answer-${o.field}`;
      case 'notice':
        return '/finance/donations/notices';
      case 'reserves':
        return '/finance/reserves';
      case 'partnerPayments':
        return '/finance/partners';
    }
  };
  return Object.fromEntries(data.lines.map((v) => [v.line, hrefOf(v)]));
}
