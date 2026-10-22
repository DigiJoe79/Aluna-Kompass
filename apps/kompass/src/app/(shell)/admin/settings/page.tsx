import { countMediaWithAiKindInternal, listThemes, managedSettings, readAllSettings, readLocales, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { panelFromQuery } from '@/components/panel-nav';
import { requireSession } from '@/lib/request-context';
import { SETTINGS_TABS } from '@/lib/settings-fields';
import { PendingPublishLine } from '@/components/site/pending-publish';
import { themeDisplayName } from '@/lib/theme-name';
import { SettingsForm } from './settings-form';

const SETTINGS_TAB_KEYS = SETTINGS_TABS.map((tab) => tab.key);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'settings.manage')) return <Page width="standard"><ForbiddenCard permission="settings.manage" /></Page>;
  const t = await getTranslations('settings');
  const tThemes = await getTranslations('themes');
  const panel = panelFromQuery((await searchParams).panel, SETTINGS_TAB_KEYS, 'organization');
  const all = readAllSettings(deps);
  const editable = Object.fromEntries(
    Object.entries(all).filter(([k]) => k.startsWith('organization.') || k.startsWith('branding.') || k.startsWith('ui.') || k.startsWith('media.'))
  );
  return (
    <Page width="standard" header={<PageHeader title={t('title')} />}>
      {/* Die Bereiche Verein und Medien stehen in den Sichten der Webseite (`publishedOrganization`, `publishedAiLabeling`, editLink /admin/settings). */}
      {panel === 'organization' || panel === 'media' ? <PendingPublishLine href="/admin/settings" className="-mt-3 mb-4 block" /> : null}
      <SettingsForm
        panel={panel}
        initial={editable}
        themes={listThemes(deps).themes.map((th) => ({ key: th.key, name: themeDisplayName(th, tThemes('defaultName')) }))}
        lastSaved={null}
        managed={Object.keys(managedSettings(deps))}
        locales={readLocales(deps)}
        aiKindCount={countMediaWithAiKindInternal(deps.db)}
      />
    </Page>
  );
}
