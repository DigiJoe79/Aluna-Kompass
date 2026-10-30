import { hasPermission, requirePermission } from '@kompass/core';
import { getStatuteContext, listStatutes, type StatuteView } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { StatuteCreateButton } from './statute-create-button';
import { StatuteList, type StatuteListRow } from './statute-list';

/** Satzung (Board 5a): alle Stände, neueste oben; „gültig“ als Marke (Ausnahme Bescheide), abgelöste gedämpft. */
export default async function StatutesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const t = await getTranslations('governance');
  const res = await listStatutes(deps, ctx, {});
  if (!res.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const fmt = dateFormatOf(deps);
  const valid = res.value.find((s) => s.state === 'valid') ?? null;
  const resolved = res.value.find((s) => s.state === 'resolved') ?? null;
  const manage = hasPermission(ctx, 'governance.manage');
  const create = manage ? <StatuteCreateButton basedOnId={null} /> : undefined;
  let lead = valid?.lastResolvedOn ? t('statutes.leadValid', { date: fmt.date(valid.lastResolvedOn) }) : '';
  if (resolved?.lastResolvedOn) {
    const ctxRes = await getStatuteContext(deps, ctx, { statuteId: resolved.id });
    const submitted = ctxRes.ok ? ctxRes.value.filing?.submittedOn ?? null : null;
    lead = `${lead} ${submitted ? t('statutes.leadFiled', { date: fmt.date(resolved.lastResolvedOn) }) : t('statutes.leadOpen', { date: fmt.date(resolved.lastResolvedOn) })}`.trim();
  }
  if (res.value.length === 0) {
    return (
      <Page width="standard" header={<PageHeader title={t('statutes.title')} actions={create} />}>
        <EmptyState title={t('statutes.emptyTitle')} text={t('statutes.emptyText')} action={create} />
      </Page>
    );
  }
  const taxText = (s: StatuteView) => {
    const r = s.taxReview;
    if (r.affectsCharity === false) return t('statutes.tax.notAffected');
    if (r.answer === 'notRelevant') return t('statutes.tax.noObjection', { date: r.submittedOn ? fmt.date(r.submittedOn) : '' });
    if (r.answer === 'newNotice') return t('statutes.tax.newNotice', { date: r.submittedOn ? fmt.date(r.submittedOn) : '' });
    return t('statutes.tax.open');
  };
  // Neueste oben: Entwürfe zuerst, dann nach Beschluss absteigend.
  const rows: StatuteListRow[] = [...res.value]
    .sort((a, b) => (b.lastResolvedOn ?? '9999').localeCompare(a.lastResolvedOn ?? '9999'))
    .map((s) => ({ id: s.id, state: s.state, title: s.lastResolvedOn ? t('statutes.version', { date: fmt.date(s.lastResolvedOn) }) : t('statutes.draft'), note: s.note, resolvedOn: s.lastResolvedOn, registeredOn: s.registeredOn, tax: taxText(s) }));
  return (
    <Page width="full" header={<PageHeader title={t('statutes.title')} description={lead || undefined} actions={create} />}>
      <StatuteList rows={rows} />
    </Page>
  );
}
