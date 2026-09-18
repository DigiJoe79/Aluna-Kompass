import { listThemes, readAllSettings, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'settings.manage')) return <ForbiddenCard permission="settings.manage" />;
  const t = await getTranslations('settings');
  const all = readAllSettings(deps);
  const editable = Object.fromEntries(
    Object.entries(all).filter(([k]) => k.startsWith('organization.') || k.startsWith('branding.') || k.startsWith('ui.'))
  );
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <SettingsForm
          initial={editable}
          themes={listThemes(deps).themes.map((th) => ({ key: th.key, name: th.name }))}
          lastSaved={null}
        />
      </div>
    </>
  );
}
