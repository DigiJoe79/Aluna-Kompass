import { hasPermission, readSetting } from '@kompass/core';
import { getAccountStatements, getImportRun, listAccounts, listCandidates, listImportRuns } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { formatEuro } from '@/lib/finance/amount';
import { formatDateOrDash } from '@/lib/finance/dates';
import { requireSession } from '@/lib/request-context';
import type { CandidateRow } from './candidates';
import { CandidatesSection } from './candidates';
import type { RunRow } from './runs-table';
import { RunsTable } from './runs-table';
import { ImportUpload } from './upload';

/**
 * „Hochgeladene Auszüge“ (F4 Task 7, B2): oben je Bankkonto „importiert bis“
 * und der Abstimmstand, die Ablagefläche (nur `finance.entriesWrite`), die
 * Tabelle der Läufe (ein Protokoll) und offene Kandidaten. `finance.read`
 * genügt zum Lesen — Hochladen, Entscheiden und Verwerfen brauchen
 * `finance.entriesWrite`.
 */
export default async function FinanceImportsPage() {
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.imports');
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const canWrite = hasPermission(ctx, 'finance.entriesWrite');
  const dateMode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const fmtDate = (value: string | null | undefined) => formatDate(value, dateMode);

  const [accountsRes, statementsRes, runsRes, candidatesRes] = await Promise.all([
    listAccounts(deps, ctx, {}),
    getAccountStatements(deps, ctx, {}),
    listImportRuns(deps, ctx, { limit: 100 }),
    listCandidates(deps, ctx, { open: true }),
  ]);
  if (!accountsRes.ok || !statementsRes.ok || !runsRes.ok || !candidatesRes.ok) return <ForbiddenCard permission="finance.read" />;

  const importableAccounts = accountsRes.value.filter((a) => a.isActive && (a.kind === 'bank' || a.kind === 'paymentService'));
  const accountNameById = new Map(accountsRes.value.map((a) => [a.id, a.name]));
  const statementByAccount = new Map(statementsRes.value.accounts.map((a) => [a.accountId, a]));

  const runRows: RunRow[] = await Promise.all(
    runsRes.value.runs.map(async (run): Promise<RunRow> => {
      const detailRes = await getImportRun(deps, ctx, { id: run.id });
      const rawTransactions = detailRes.ok ? detailRes.value.rawTransactions : [];
      return {
        id: run.id,
        accountId: run.accountId,
        accountName: accountNameById.get(run.accountId) ?? '',
        format: run.format,
        formatName: run.formatName,
        periodFrom: run.periodFrom,
        periodTo: run.periodTo,
        openingCents: run.openingCents,
        closingCents: run.closingCents,
        counts: run.counts,
        gap: run.gap,
        state: run.state,
        failure: run.failure,
        startedAt: run.startedAt,
        createdByUserName: run.createdByUserName,
        rawTransactions: rawTransactions.map((raw) => ({
          id: raw.id,
          bookingDate: raw.bookingDate,
          counterpartyName: raw.counterpartyName,
          purpose: raw.purpose,
          amountCents: raw.amountCents,
          state: raw.state,
          entryId: raw.entryId,
          entryNumber: raw.entryNumber,
        })),
      };
    }),
  );

  const candidateRows: CandidateRow[] = candidatesRes.value.candidates.map((c) => ({
    id: c.id,
    accountName: accountNameById.get(c.accountId) ?? '',
    line: { bookingDate: c.line.bookingDate, counterpartyName: c.line.counterpartyName, purpose: c.line.purpose, amountCents: c.line.amountCents },
    existing: c.existing
      ? { bookingDate: c.existing.bookingDate, counterpartyName: c.existing.counterpartyName, purpose: c.existing.purpose, amountCents: c.existing.amountCents, state: c.existing.state, entryId: c.existing.entryId, entryNumber: c.existing.entryNumber }
      : null,
  }));

  if (importableAccounts.length === 0) {
    return <EmptyState title={t('empty.title')} text={t('empty.text')} />;
  }

  return (
    <div className="max-w-[1100px] space-y-6">
      <PageHeader title={t('title')} />

      <section aria-label={t('accountsSummary.title')} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {importableAccounts.map((a) => {
          const s = statementByAccount.get(a.id);
          return (
            <div key={a.id} className="rounded-md border border-line bg-surface p-3 text-[13px]">
              <p className="font-semibold text-ink">{a.name}</p>
              <p className="text-ink-2">{s?.importedThrough ? t('accountsSummary.through', { date: fmtDate(s.importedThrough) }) : t('accountsSummary.none')}</p>
              <p className="text-muted-ink">
                {!s?.reconciliation || s.reconciliation.state === 'noStatement'
                  ? t('accountsSummary.noStatement')
                  : s.reconciliation.state === 'matches'
                    ? t('accountsSummary.matches', { date: formatDateOrDash(fmtDate, s.reconciliation.statementDate) })
                    : t('accountsSummary.differs', { date: formatDateOrDash(fmtDate, s.reconciliation.statementDate), amount: formatEuro(s.reconciliation.differenceCents ?? 0) })}
              </p>
            </div>
          );
        })}
      </section>

      {canWrite ? <ImportUpload accounts={importableAccounts.map((a) => ({ id: a.id, name: a.name }))} /> : null}

      <RunsTable runs={runRows} canDiscard={canWrite} />

      <CandidatesSection candidates={candidateRows} canDecide={canWrite} />
    </div>
  );
}
