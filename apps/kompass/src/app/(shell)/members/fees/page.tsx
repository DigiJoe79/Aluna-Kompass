import { hasPermission, readLocales, readSetting, requirePermission, todayIn } from '@kompass/core';
import { listFees, listFeeSchedules, listMemberTypes, previewFeeRun, type DunningLevel } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { dateFormatOf } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { nameOrEmpty } from '@/lib/name-or-empty';
import { requireSession } from '@/lib/request-context';
import { FeeList } from './fee-list';
import { FeesYearPicker } from './year-picker';

const PAGE_SIZE = 50;
const STATES = ['open', 'partlyPaid', 'paid', 'waived', 'overdue'] as const;

/**
 * Beiträge (Handoff Mitglieder 2.4, 4a–4c): `full`, das Jahr vorn. Kopf: Primär „Mahnlauf“, Nebenaktionen „Beiträge
 * anlegen“ und „Liste exportieren (CSV)“. Ein Jahr ohne Beiträge zeigt, was die Beitragsordnung ergäbe, und führt zum
 * Beitragslauf; „Mahnlauf“ fehlt dann.
 */
export default async function FeesPage({ searchParams }: { searchParams: Promise<{ year?: string; text?: string; state?: string; type?: string; page?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'members.read')) return <Page width="full"><ForbiddenCard permission="members.read" /></Page>;
  const t = await getTranslations('members.fees');
  const q = await searchParams;
  const today = todayIn(deps);
  const current = Number(today.slice(0, 4));
  const parsed = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : current;
  const year = parsed >= 2000 && parsed <= current + 1 ? parsed : current;
  const years = Array.from({ length: 7 }, (_, i) => current + 1 - i);
  if (!years.includes(year)) years.push(year);
  const state = STATES.find((s) => s === q.state);
  const offset = (Math.max(1, Number(q.page) || 1) - 1) * PAGE_SIZE;
  const [list, all, types] = await Promise.all([
    listFees(deps, ctx, { year, ...(q.text?.trim() ? { search: q.text.trim().slice(0, 200) } : {}), ...(state ? { status: [state] } : {}), ...(q.type ? { typeId: q.type } : {}), limit: PAGE_SIZE, offset }),
    listFees(deps, ctx, { year, limit: 1 }),
    listMemberTypes(deps, ctx, { includeInactive: true }),
  ]);
  if (!list.ok || !all.ok) return <Page width="full"><ForbiddenCard permission="members.read" /></Page>;
  const canFees = hasPermission(ctx, 'members.fees');
  const leading = readLocales(deps)[0] ?? 'de';
  const exportParams = new URLSearchParams(Object.entries({ year: String(year), text: q.text, state: q.state, type: q.type }).filter((e): e is [string, string] => !!e[1]));
  const runHref = `/members/fees/run?year=${year}`;
  const empty = all.value.total === 0;

  const header = (
    <PageHeader
      title={t('title')}
      more={[
        { key: 'createRun', label: t('createRun'), href: runHref, hidden: !canFees || empty },
        { key: 'export', label: t('exportCsv'), href: `/members/fees/export?${exportParams.toString()}`, hidden: empty, testId: 'fees-export' },
      ]}
      actions={canFees && !empty ? <Link href="/members/fees/dunning" className={buttonVariants()}>{t('dunningRun')}</Link> : null}
    />
  );

  if (empty) {
    // 4c: was die Beitragsordnung für das Jahr ergäbe — Zahl, Summe und Fälligkeit aus der Vorschau des Laufs.
    const [preview, schedules] = await Promise.all([previewFeeRun(deps, ctx, { year }), listFeeSchedules(deps, ctx, {})]);
    const fmt = dateFormatOf(deps);
    const create = preview.ok ? preview.value.items.filter((i) => i.outcome === 'create') : [];
    const from = schedules.ok ? schedules.value.filter((s) => s.validFrom <= `${year}-12-31`).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.validFrom : undefined;
    const due = create.map((i) => i.dueOn).sort()[0];
    return (
      <Page width="full" header={header}>
        <div className="space-y-4">
          <FeesYearPicker year={year} years={years} />
          <EmptyState
            title={t('empty.year', { year })}
            text={preview.ok && create.length > 0 && from && due ? t('empty.yearText', { from: fmt.date(from), count: create.length, sum: formatEuro(preview.value.totals.sumCents), due: fmt.date(due) }) : t('empty.yearNothing', { year })}
            action={canFees && create.length > 0 ? <Link href={runHref} className={buttonVariants()}>{t('createRun')}</Link> : undefined}
          />
        </div>
      </Page>
    );
  }

  const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels').map((l, i, list) => ({ key: l.key, name: nameOrEmpty(l.name[leading], l.key), last: i === list.length - 1 }));
  return (
    <Page width="full" header={header}>
      <FeeList
        year={year}
        years={years}
        rows={list.value.items}
        total={list.value.total}
        unfiltered={all.value.total}
        offset={offset}
        pageSize={PAGE_SIZE}
        totals={list.value.totals}
        exempt={list.value.exempt}
        types={types.ok ? types.value.map((ty) => ({ id: ty.id, name: nameOrEmpty(ty.name[leading], ty.key) })) : []}
        levels={levels}
        canFees={canFees}
        today={today}
      />
    </Page>
  );
}
