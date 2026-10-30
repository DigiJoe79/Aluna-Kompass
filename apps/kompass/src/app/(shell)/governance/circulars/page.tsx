import { hasPermission, requirePermission, todayIn } from '@kompass/core';
import { listCirculars, listOrgans } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { circularState } from '@/lib/governance/circular-state';
import { requireSession } from '@/lib/request-context';
import { CircularList } from './circular-list';

type Query = { organ?: string; year?: string };

/** Umlaufbeschlüsse: Kompass erfasst, verschickt nicht (Spec § 5.6). */
export default async function CircularsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const t = await getTranslations('governance');
  const q = await searchParams;
  const year = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : undefined;
  const [all, filtered, organs] = await Promise.all([listCirculars(deps, ctx, {}), listCirculars(deps, ctx, { ...(q.organ ? { organId: q.organ } : {}), ...(year ? { year } : {}) }), listOrgans(deps, ctx, { includeInactive: true })]);
  if (!all.ok || !filtered.ok || !organs.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const create = hasPermission(ctx, 'governance.manage') ? <Link href="/governance/circulars/new" className={buttonVariants()}>{t('circulars.create')}</Link> : undefined;
  const header = <PageHeader title={t('circulars.title')} actions={create} />;
  if (all.value.length === 0) return <Page width="standard" header={header}><EmptyState title={t('circulars.emptyTitle')} text={t('circulars.emptyText')} action={create} /></Page>;
  const today = todayIn(deps);
  const organName = new Map(organs.value.map((o) => [o.id, o.name]));
  const rows = [...filtered.value].reverse().map((c) => ({ id: c.id, subject: (c.text.split('\n').find((l) => l.trim()) ?? '').trim(), organ: organName.get(c.organId) ?? '', requestedOn: c.requestedOn, deadline: c.deadline, state: circularState(c, today), sealed: c.sealedAt !== null }));
  const years = [...new Set(all.value.map((c) => c.requestedOn.slice(0, 4)))].sort().reverse();
  return (
    <Page width="full" header={header}>
      <CircularList rows={rows} total={all.value.length} organs={organs.value.map((o) => ({ id: o.id, name: o.name }))} years={years} />
    </Page>
  );
}
