import { hasPermission, isModuleEnabled, readSetting, requirePermission } from '@kompass/core';
import { PHOTO_FRAME_KEY, PROFILE_URL_KEY, type PhotoFrame } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { AnimalSettingsPanel } from './settings-panel';

/** Einstellungen des Tiermoduls: der Ausschnitt des Hauptfotos und die Adresse des Online-Profils. */
export default async function AdminAnimalsPage() {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'animals')) return <Page width="standard"><ModuleInactiveCard namespace="animals.common" /></Page>;
  if (requirePermission(ctx, 'settings.manage')) return <Page width="standard"><ForbiddenCard permission="settings.manage" /></Page>;
  const t = await getTranslations('animals.admin');
  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <AnimalSettingsPanel initial={{ frame: readSetting<PhotoFrame>(deps, PHOTO_FRAME_KEY), profileUrl: readSetting<string>(deps, PROFILE_URL_KEY) }} canManage={hasPermission(ctx, 'settings.manage')} />
    </Page>
  );
}
