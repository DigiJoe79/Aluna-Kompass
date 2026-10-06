import { listThemes, managedSettings, readAllSettings, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { panelFromQuery } from '@/components/panel-nav';
import { requireSession } from '@/lib/request-context';
import { SETTINGS_TABS } from '@/lib/settings-fields';
import { SettingsForm } from './settings-form';

const SETTINGS_TAB_KEYS = SETTINGS_TABS.map((tab) => tab.key);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'settings.manage')) return <Page width="standard"><ForbiddenCard permission="settings.manage" /></Page>;
  const t = await getTranslations('settings');
  const panel = panelFromQuery((await searchParams).panel, SETTINGS_TAB_KEYS, 'organization');
  const all = readAllSettings(deps);
  const editable = Object.fromEntries(
    Object.entries(all).filter(([k]) => k.startsWith('organization.') || k.startsWith('branding.') || k.startsWith('ui.'))
  );
  return (
    <Page width="standard" header={<PageHeader title={t('title')} />}>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <SettingsForm
          panel={panel}
          initial={editable}
          themes={listThemes(deps).themes.map((th) => ({ key: th.key, name: th.name }))}
          lastSaved={null}
          managed={Object.keys(managedSettings(deps))}
        />
      </div>
    </Page>
  );
}
