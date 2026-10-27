import { hasPermission, resolveFollowUpTarget, resolveRecordLabel, todayIn } from '@kompass/core';
import { getThresholds, listFinanceDeadlines, listFiscalYears } from '@kompass/module-finance';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { requireSession } from '@/lib/request-context';
import { DeadlineList, DeadlinesHeader } from './deadline-list';
import { FollowUpList, type FollowUpRow } from './follow-up-list';
import { ThresholdList } from './threshold-list';

/**
 * Fristen und Schwellen (Spec 0.4.0 § C, Board 6a): berechnete Fristen, Wiedervorlagen (nur mit `followUps.view`) und
 * die Schwellen eines Jahres (Jahr als Rahmen, Vorgabe das laufende). `standard`. Lesen mit `finance.overview` —
 * ohne `finance.read` nennt der Dienst keine Namen.
 */
export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.overview')) return <Page width="standard"><ForbiddenCard permission="finance.overview" /></Page>;
  const today = todayIn(deps);
  const query = await searchParams;
  const listed = await listFinanceDeadlines(deps, ctx, {});
  if (!listed.ok) return <Page width="standard"><ForbiddenCard permission="finance.overview" /></Page>;
  const { computed, followUps, suggestions } = listed.value;

  const yearsRes = await listFiscalYears(deps, ctx);
  const years = (yearsRes.ok ? yearsRes.value : []).slice().sort((a, b) => b.endsOn.localeCompare(a.endsOn));
  const running = years.find((y) => y.startsOn <= today && y.endsOn >= today) ?? years[0] ?? null;
  const year = years.find((y) => y.id === query.year) ?? running;
  const thresholdsRes = year ? await getThresholds(deps, ctx, { fiscalYearId: year.id }) : null;
  const thresholds = thresholdsRes?.ok ? thresholdsRes.value : [];

  const rows: FollowUpRow[] = (followUps ?? []).map((f) => {
    const label = resolveRecordLabel(deps, ctx, f.entityType, f.entityId);
    const target = label && label.state !== 'missing' ? { label: label.label, ...(label.href ? { href: label.href } : {}) } : label ? null : resolveFollowUpTarget(deps, f.entityType, f.entityId);
    return { id: f.id, dueAt: f.dueAt, title: f.title, titleHidden: f.titleHidden, doneAt: f.doneAt, target };
  });
  const suggestion = suggestions.find((s) => s.key === 'closeBeforeAssembly') ?? null;
  const yearOptions = years.map((y) => ({ id: y.id, designation: y.designation }));

  return (
    <Page width="standard" header={<DeadlinesHeader deadlines={computed} approaching={thresholds.filter((x) => x.state === 'approaching').length} exceeded={thresholds.filter((x) => x.state === 'exceeded').length} />}>
      <div className="flex flex-col">
        <DeadlineList deadlines={computed} canFileVat={hasPermission(ctx, 'finance.periodClose')} canRead={hasPermission(ctx, 'finance.read')} today={today} />
        {followUps ? <FollowUpList rows={rows} canManage={hasPermission(ctx, 'followUps.manage')} years={yearOptions} defaultYearId={running?.id ?? null} suggestion={suggestion ? { fiscalYearId: suggestion.fiscalYearId, designation: suggestion.designation } : null} today={today} /> : null}
        {year ? <ThresholdList thresholds={thresholds} years={yearOptions} yearId={year.id} designation={year.designation} /> : null}
      </div>
    </Page>
  );
}
