import { hasPermission, isModuleEnabled, readLocales, readSetting, requirePermission, todayIn } from '@kompass/core';
import { getDocumentRecord, listSnippets } from '@kompass/module-dms';
import { countMembersAt, getMembersSettings, listFeeSchedules, listMemberTypes } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { PanelNav, panelFromQuery } from '@/components/panel-nav';
import { nameOrEmpty } from '@/lib/name-or-empty';
import { requireSession } from '@/lib/request-context';
import { DunningPanel } from './dunning-panel';
import { NumbersPanel } from './numbers-panel';
import { SchedulePanel } from './schedule-panel';
import { TypesPanel } from './types-panel';

const PANELS = ['types', 'feeSchedule', 'dunning', 'numbers'] as const;

/**
 * Einstellungen Mitglieder (Handoff Mitglieder 2.6, 7a–7c): `PanelNav` Mitgliedsarten · Beitragsordnung · Mahnstufen ·
 * Nummern und Fristen. Lesen mit `members.read`, ändern mit `members.fees` — die Dienste prüfen.
 */
export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'members')) return <Page width="standard"><ModuleInactiveCard namespace="members.common" /></Page>;
  if (requirePermission(ctx, 'members.fees')) return <Page width="standard"><ForbiddenCard permission="members.fees" /></Page>;
  const t = await getTranslations('members.admin');
  const panel = panelFromQuery((await searchParams).panel, PANELS, 'types');
  const locales = readLocales(deps);
  const leading = locales[0] ?? 'de';
  const today = todayIn(deps);
  const types = await listMemberTypes(deps, ctx, { includeInactive: true });
  const typeRows = types.ok ? types.value : [];
  const label = (ty: (typeof typeRows)[number]) => nameOrEmpty(ty.name[leading], ty.key);

  let content: React.ReactNode = null;
  if (panel === 'types') {
    const counts = await countMembersAt(deps, ctx, { date: today });
    const count = (id: string) => (counts.ok ? (counts.value.byType.find((c) => c.typeId === id)?.count ?? 0) : 0);
    content = <TypesPanel types={typeRows.map((ty) => ({ id: ty.id, key: ty.key, name: ty.name, label: label(ty), hasVotingRight: ty.hasVotingRight, feeExempt: ty.feeExempt, active: ty.active, count: count(ty.id) }))} locales={locales} />;
  } else if (panel === 'feeSchedule') {
    const schedules = await listFeeSchedules(deps, ctx, {});
    const list = schedules.ok ? schedules.value : [];
    const documents = await Promise.all(
      list.map(async (s) => {
        if (!s.resolutionDocumentId) return null;
        const record = hasPermission(ctx, 'dms.view') ? await getDocumentRecord(deps, ctx, s.resolutionDocumentId) : null;
        return { id: s.resolutionDocumentId, number: record?.ok ? record.value.number : null };
      }),
    );
    content = (
      <SchedulePanel
        schedules={list.map((s, i) => ({ id: s.id, validFrom: s.validFrom, resolvedOn: s.resolvedOn, resolutionDocument: documents[i] ?? null, rules: s.rules.map((r) => ({ typeId: r.typeId, amountCents: r.amountCents, interval: r.interval, minimum: r.minimum, allowedIntervals: r.allowedIntervals })), locked: s.locked }))}
        types={typeRows.map((ty) => ({ id: ty.id, label: label(ty), feeExempt: ty.feeExempt, active: ty.active }))}
        today={today}
      />
    );
  } else {
    const settings = await getMembersSettings(deps, ctx);
    if (settings.ok && panel === 'dunning') {
      const snippets = await listSnippets(deps, ctx, {});
      content = (
        <DunningPanel
          levels={settings.value.dunningLevels.map((l) => ({ key: l.key, name: l.name as Record<string, string>, label: nameOrEmpty(l.name[leading], l.key), daysAfter: l.daysAfter, snippetId: l.snippetId }))}
          snippets={snippets.ok ? snippets.value.map((s) => ({ id: s.id, name: s.name })) : []}
          locales={locales}
        />
      );
    } else if (settings.ok) {
      const s = settings.value;
      content = (
        <NumbersPanel
          values={{ nextNumber: s.nextNumber, noticeMonths: s.resignationNotice.months, noticeAt: s.resignationNotice.at, paymentTermDays: s.paymentTermDays, joinYearRule: s.joinYearRule }}
          agent={{ allowed: readSetting<boolean>(deps, 'members.mcpHumanOnlyAllowed') === true, canChange: hasPermission(ctx, 'settings.manage') }}
        />
      );
    }
  }

  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <div className="space-y-5">
        <PanelNav basePath="/admin/members" panels={PANELS} active={panel} labels={Object.fromEntries(PANELS.map((k) => [k, t(`tabs.${k}`)])) as Record<(typeof PANELS)[number], string>} ariaLabel={t('tabsLabel')} />
        {content}
      </div>
    </Page>
  );
}
