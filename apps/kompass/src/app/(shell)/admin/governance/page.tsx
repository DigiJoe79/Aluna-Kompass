import { hasPermission, isModuleEnabled, readSetting, requirePermission } from '@kompass/core';
import { listAdoptableRoleRows, listOrgans } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { PanelNav, panelFromQuery } from '@/components/panel-nav';
import { requireSession } from '@/lib/request-context';
import { RoleAdoptionPanel } from './role-adoption-panel';
import { GovernanceSettingsForm } from './settings-form';

const PANELS = ['deadlines', 'roles'] as const;

/**
 * Einstellungen Gremien (Plan U1 Task 12, U2 Task 15): `PanelNav` mit „Fristen“ und „Rollenübernahme“. Sehen mit `governance.manage`, ändern mit `settings.manage` — der Dienst prüft.
 */
export default async function AdminGovernancePage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'governance')) return <Page width="standard"><ModuleInactiveCard namespace="governance.common" /></Page>;
  if (requirePermission(ctx, 'governance.manage')) return <Page width="standard"><ForbiddenCard permission="governance.manage" /></Page>;
  const t = await getTranslations('governance.admin');
  const tr = await getTranslations('contacts.roleNames');
  const panel = panelFromQuery((await searchParams).panel, PANELS, 'deadlines');
  let content: React.ReactNode;
  if (panel === 'roles') {
    const [rows, organs] = await Promise.all([listAdoptableRoleRows(deps, ctx, {}), listOrgans(deps, ctx, {})]);
    const offices = organs.ok ? organs.value.flatMap((o) => o.offices.map((x) => ({ id: x.id, name: x.name }))) : [];
    const roles = rows.ok ? [...new Set(rows.value.map((r) => r.role))] : [];
    content = <RoleAdoptionPanel rows={rows.ok ? rows.value : []} offices={offices} roleNames={Object.fromEntries(roles.map((r) => [r, tr.has(r) ? tr(r) : r]))} />;
  } else {
    content = (
      <GovernanceSettingsForm
        values={{
          deadlineLeadDays: readSetting<number>(deps, 'governance.deadlineLeadDays'),
          registerOverdueDays: readSetting<number>(deps, 'governance.registerOverdueDays'),
          taxNoticeRequestDays: readSetting<number>(deps, 'governance.taxNoticeRequestDays'),
          ordinaryMeetingWarnFrom: readSetting<string>(deps, 'governance.ordinaryMeetingWarnFrom'),
        }}
        canChange={hasPermission(ctx, 'settings.manage')}
      />
    );
  }
  return (
    <Page width="standard" header={<PageHeader title={t('title')} />}>
      <div className="space-y-5">
        <PanelNav basePath="/admin/governance" panels={PANELS} active={panel} labels={{ deadlines: t('tabs.deadlines'), roles: t('tabs.roles') }} ariaLabel={t('tabsLabel')} />
        {content}
      </div>
    </Page>
  );
}
