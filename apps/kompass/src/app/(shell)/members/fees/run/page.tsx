import { hasPermission, requirePermission, todayIn } from '@kompass/core';
import { getFeeRun, listFeeRuns, previewFeeRun, runDispatchState } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ListPager } from '@/components/list-pager';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { EarlierRuns } from '../../runs/earlier-runs';
import { MemberRunDispatch } from '../../runs/run-dispatch';
import { RunProgress } from '../../runs/run-progress';
import { RunSteps } from '../../runs/run-steps';
import { FeeRunFlow } from './fee-run-flow';

const RUNS_PAGE_SIZE = 50;

/**
 * Beitragslauf (Handoff Mitglieder 2.5, 5a/5b): Auswahl · Vorschau · Lauf · Versand wie der Serienlauf. Die Auswahl
 * steht in der Adresse (`?year=&notices=`), ein Lauf als `?run=` — ein Neuladen zeigt denselben Stand.
 */
export default async function FeeRunPage({ searchParams }: { searchParams: Promise<{ year?: string; notices?: string; run?: string; runsPage?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'members.read')) return <Page width="standard"><ForbiddenCard permission="members.read" /></Page>;
  const t = await getTranslations('members');
  const nav = await getTranslations('nav');
  const q = await searchParams;
  const canFees = hasPermission(ctx, 'members.fees');
  const today = todayIn(deps);
  const current = Number(today.slice(0, 4));
  const years = [current + 1, current, current - 1];
  const yearParam = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : null;
  const notices = q.notices === 'all' ? 'all' : 'directDebitOnly';

  const runsPage = Math.max(1, Number(q.runsPage) || 1);
  const runs = await listFeeRuns(deps, ctx, { limit: RUNS_PAGE_SIZE, offset: (runsPage - 1) * RUNS_PAGE_SIZE });
  const earlier = runs.ok
    ? runs.value.items.map((r) => ({ id: r.id, label: String(r.year), href: `/members/fees/run?run=${r.id}`, createdAt: r.createdAt, result: t('runs.earlier.feesResult', { created: r.created, notices: r.noticesIssued }), running: r.status === 'running' }))
    : [];
  const pager = runs.ok ? <ListPager total={runs.value.total} offset={(runsPage - 1) * RUNS_PAGE_SIZE} pageSize={RUNS_PAGE_SIZE} hrefFor={(next) => `/members/fees/run?runsPage=${Math.floor(next / RUNS_PAGE_SIZE) + 1}`} footer /> : null;

  let body: ReactNode;
  let currentId: string | null = null;
  const run = q.run ? await getFeeRun(deps, ctx, q.run) : null;
  if (run?.ok) {
    currentId = run.value.id;
    if (run.value.status === 'running') {
      body = (
        <>
          <RunSteps active="run" />
          <RunProgress url={`/members/fees/run/${run.value.id}/continue`} kind="fees" initial={{ done: run.value.created, total: run.value.created + run.value.pending, notices: run.value.noticesIssued }} canContinue={canFees} />
        </>
      );
    } else {
      const runRef = `membersFeeRun:${run.value.id}`;
      const state = await runDispatchState(deps, ctx, { runRef });
      const refusedPrenotifications = run.value.noticeRefused.filter((r) => r.letter === 'prenotification').length;
      const refusedNotices = run.value.noticeRefused.length - refusedPrenotifications;
      body = (
        <>
          <RunSteps active={state.ok && state.value.done ? null : 'dispatch'} />
          <p data-testid="run-summary" className="text-body text-ink">{t('runs.result.fees', { created: run.value.created, notices: run.value.noticesIssued })}</p>
          {/* Backlog 78: Was der Lauf nicht erzeugen oder diese Rolle nicht versenden konnte, steht hier statt still zu fehlen. */}
          {refusedNotices > 0 ? <Notice level="hint" testId="run-notices-refused">{t('runs.result.noticesRefused', { count: refusedNotices })}</Notice> : null}
          {refusedPrenotifications > 0 ? <Notice level="hint" testId="run-prenotifications-refused">{t('runs.result.prenotificationRefused', { count: refusedPrenotifications })}</Notice> : null}
          {state.ok && state.value.restricted > 0 ? <Notice level="hint" testId="run-restricted">{t('runs.result.restricted', { count: state.value.restricted })}</Notice> : null}
          {state.ok && state.value.mail.length + state.value.post.length > 0 ? (
            <MemberRunDispatch runRef={runRef} state={state.value} detail={t('feeRun.noticeDetail')} canSend={canFees && hasPermission(ctx, 'dms.send')} canMark={canFees} today={today} />
          ) : state.ok && state.value.restricted > 0 ? null : (
            <p className="text-meta text-muted-ink">{t('runs.result.noLetters')}</p>
          )}
        </>
      );
    }
  } else {
    const preview = yearParam !== null ? await previewFeeRun(deps, ctx, { year: yearParam }) : null;
    body = <FeeRunFlow key={`${yearParam}-${notices}`} years={years} year={yearParam} notices={notices} preview={preview?.ok ? preview.value : null} canStart={canFees} />;
  }

  return (
    <Page width="standard" header={<PageHeader title={t('feeRun.title')} description={t('feeRun.description')} back={{ href: '/members/fees', label: nav('members.fees') }} />}>
      <div className="space-y-6">
        <div className="space-y-4">{body}</div>
        <EarlierRuns runs={earlier} currentId={currentId} labelColumn={t('runs.earlier.year')} footer={pager} />
      </div>
    </Page>
  );
}
