import { hasPermission } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { getConfirmationRun, listConfirmationRuns, previewConfirmationRun, type RunView } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { missingDonors, parseRunQuery, runQueryString, runStep } from '@/lib/finance/run';
import { requireSession } from '@/lib/request-context';
import { RunProgress } from './run-progress';
import { RunResult } from './run-result';
import { RunSelection } from './run-selection';
import { RunSteps } from './run-steps';
import { RunsList } from './runs-list';

export interface DonationRunQuery {
  year?: string;
  min?: string;
  exclude?: string;
  followUp?: string;
  run?: string;
}

/** So weit zurück bietet die Auswahl Jahre an; ältere Jahre gehen über die Adresse. */
const YEARS_BACK = 5;

/**
 * Serienlauf (C2, F6b Task 7, README 3i): Auswahl · Vorschau · Lauf ·
 * Ergebnis. Lesen mit `finance.read`, starten, fortsetzen und den Versand
 * vermerken mit `finance.donationsIssue`. Die Auswahl steht in der Adresse
 * (`?year=&min=&exclude=&followUp=`), ein Lauf als `?run=` — so zeigt ein
 * Neuladen denselben Stand, und ein angehaltener Lauf setzt beim nächsten
 * Besuch fort.
 */
export default async function DonationRunPage({ searchParams }: { searchParams: Promise<DonationRunQuery> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.donations.run');
  const query = parseRunQuery(await searchParams);
  const canIssue = hasPermission(ctx, 'finance.donationsIssue');
  const today = deps.clock.now().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4));

  const runsRes = await listConfirmationRuns(deps, ctx, { limit: 20 });
  const runs = runsRes.ok ? runsRes.value.items : [];

  let run: RunView | null = null;
  if (query.runId) {
    const runRes = await getConfirmationRun(deps, ctx, { id: query.runId });
    if (!runRes.ok) {
      return (
        <div className="max-w-[1100px] space-y-4">
          <PageHeader title={t('title')} description={t('description')} />
          <EmptyState title={t('empty.title')} text={t('empty.text')} />
          <RunsList runs={runs} currentId={null} />
        </div>
      );
    }
    run = runRes.value;
  }

  const step = runStep({ year: query.year, run });
  let body: ReactNode;
  if (run && step === 'run') {
    body = (
      <>
        <RunSteps active="run" />
        <RunProgress key={run.id} runId={run.id} counts={run.counts} canContinue={canIssue} />
      </>
    );
  } else if (run) {
    // „Wer fehlt“: dieselbe Vorschau als Nachzügler — bestätigte Zeilen fallen ohnehin heraus (Annahme 6).
    const followUpRes = await previewConfirmationRun(deps, ctx, { year: run.year, minCents: run.minCents, followUpOfRunId: run.id });
    const missing = followUpRes.ok ? missingDonors(followUpRes.value.items) : { count: 0, names: [] };
    body = (
      <>
        <RunSteps active="result" />
        <RunResult
          run={run}
          canIssue={canIssue}
          today={today}
          missing={missing}
          followUpHref={`/finance/donations/run${runQueryString({ year: run.year, minCents: run.minCents, excluded: [], followUp: run.id })}`}
        />
      </>
    );
  } else {
    const followUpRun = query.followUp ? await getConfirmationRun(deps, ctx, { id: query.followUp }) : null;
    const followUp = followUpRun?.ok ? { id: followUpRun.value.id, startedOn: followUpRun.value.startedOn } : null;
    const previewRes =
      query.year !== null
        ? await previewConfirmationRun(deps, ctx, {
            year: query.year,
            ...(query.minCents !== null ? { minCents: query.minCents } : {}),
            excludedContactIds: query.excluded,
            ...(followUp ? { followUpOfRunId: followUp.id } : {}),
          })
        : null;
    // Namen der Ausgeschlossenen für die Leiste — wer Kontakte nicht lesen darf, sieht einen Platzhalter.
    const excluded = await Promise.all(
      query.excluded.map(async (id) => {
        const contact = await getContact(deps, ctx, id);
        return { id, name: contact.ok ? displayName(contact.value) : t('selection.unknownContact') };
      }),
    );
    const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => currentYear - i);
    if (query.year !== null && !years.includes(query.year)) years.push(query.year);
    body = (
      <RunSelection
        key={`${query.year}-${query.followUp ?? ''}`}
        years={years}
        defaultYear={currentYear - 1}
        year={query.year}
        minCents={query.minCents}
        excluded={excluded}
        followUp={followUp}
        preview={previewRes?.ok ? previewRes.value : null}
        canIssue={canIssue}
      />
    );
  }

  return (
    <div className="max-w-[1100px] space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="space-y-4">{body}</div>
      <RunsList runs={runs} currentId={run?.id ?? null} />
    </div>
  );
}
