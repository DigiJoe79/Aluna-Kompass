import { hasPermission, readSetting, requirePermission, todayIn } from '@kompass/core';
import { getDunningRun, listDunningRuns, previewDunningRun, runDispatchState, type DunningLevel } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ListPager } from '@/components/list-pager';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { EarlierRuns } from '../../runs/earlier-runs';
import { MemberRunDispatch } from '../../runs/run-dispatch';
import { RunProgress } from '../../runs/run-progress';
import { RunSteps } from '../../runs/run-steps';
import { DunningRunFlow } from './dunning-run-flow';

const RUNS_PAGE_SIZE = 50;

/**
 * Mahnlauf (Handoff Mitglieder 2.5, 6a–6c, N4): Auswahl (Stichtag) · Vorschau · Lauf · Versand. Eine Stufe gilt erst mit
 * Versandvermerk als erreicht; davon hängt die Frist der nächsten ab.
 */
export default async function DunningRunPage({ searchParams }: { searchParams: Promise<{ asOf?: string; run?: string; runsPage?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'members.read')) return <Page width="standard"><ForbiddenCard permission="members.read" /></Page>;
  const t = await getTranslations('members');
  const nav = await getTranslations('nav');
  const q = await searchParams;
  const canFees = hasPermission(ctx, 'members.fees');
  const today = todayIn(deps);
  const fmt = dateFormatOf(deps);
  const asOf = q.asOf && /^\d{4}-\d{2}-\d{2}$/.test(q.asOf) ? q.asOf : null;
  const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels').map((l, i, all) => ({ key: l.key, last: i === all.length - 1 }));

  const runsPage = Math.max(1, Number(q.runsPage) || 1);
  const runs = await listDunningRuns(deps, ctx, { limit: RUNS_PAGE_SIZE, offset: (runsPage - 1) * RUNS_PAGE_SIZE });
  const earlier = runs.ok
    ? runs.value.items.map((r) => ({ id: r.id, label: fmt.date(r.asOf), href: `/members/fees/dunning?run=${r.id}`, createdAt: r.createdAt, result: t('runs.earlier.lettersResult', { count: r.issued }), running: r.status === 'running' }))
    : [];
  const pager = runs.ok ? <ListPager total={runs.value.total} offset={(runsPage - 1) * RUNS_PAGE_SIZE} pageSize={RUNS_PAGE_SIZE} hrefFor={(next) => `/members/fees/dunning?runsPage=${Math.floor(next / RUNS_PAGE_SIZE) + 1}`} footer /> : null;

  let body: ReactNode;
  let currentId: string | null = null;
  const run = q.run ? await getDunningRun(deps, ctx, q.run) : null;
  if (run?.ok) {
    currentId = run.value.id;
    if (run.value.status === 'running') {
      body = (
        <>
          <RunSteps active="run" />
          <RunProgress url={`/members/fees/dunning/${run.value.id}/continue`} kind="letters" initial={{ done: run.value.issued, total: run.value.issued + run.value.remaining }} canContinue={canFees} />
        </>
      );
    } else {
      const runRef = `membersDunningRun:${run.value.id}`;
      const state = await runDispatchState(deps, ctx, { runRef });
      body = (
        <>
          <RunSteps active={state.ok && state.value.done ? null : 'dispatch'} />
          <p data-testid="run-summary" className="text-body text-ink">{t('runs.result.letters', { count: run.value.issued })}</p>
          {state.ok && state.value.mail.length + state.value.post.length > 0 ? (
            <MemberRunDispatch runRef={runRef} state={state.value} detail={null} canSend={canFees && hasPermission(ctx, 'dms.send')} canMark={canFees} today={today} />
          ) : (
            <p className="text-meta text-muted-ink">{t('runs.result.noLetters')}</p>
          )}
        </>
      );
    }
  } else {
    const preview = asOf ? await previewDunningRun(deps, ctx, { asOf }) : null;
    body = <DunningRunFlow key={asOf ?? ''} asOf={asOf} today={today} preview={preview?.ok ? preview.value : null} paymentTermDays={readSetting<number>(deps, 'members.paymentTermDays')} levels={levels} canStart={canFees} />;
  }

  return (
    <Page width="standard" header={<PageHeader title={t('dunningRun.title')} description={t('dunningRun.description')} back={{ href: '/members/fees', label: nav('members.fees') }} />}>
      <div className="space-y-6">
        <div className="space-y-4">{body}</div>
        <EarlierRuns runs={earlier} currentId={currentId} labelColumn={t('runs.earlier.asOf')} footer={pager} />
      </div>
    </Page>
  );
}
