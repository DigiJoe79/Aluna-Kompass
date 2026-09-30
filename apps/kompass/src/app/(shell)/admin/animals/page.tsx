import { hasPermission, isModuleEnabled, readSetting, requirePermission } from '@kompass/core';
import { PHOTO_FRAME_KEY, type PhotoFrame } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { PhotoFramePanel } from './photo-frame-panel';

/** Einstellungen des Tiermoduls. Heute eine: der Ausschnitt des Hauptfotos, wie ihn das Template zeigt. */
export default async function AdminAnimalsPage() {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'animals')) return <ModuleInactiveCard namespace="animals.common" />;
  if (requirePermission(ctx, 'settings.manage')) return <ForbiddenCard permission="settings.manage" />;
  const t = await getTranslations('animals.admin');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PhotoFramePanel initial={readSetting<PhotoFrame>(deps, PHOTO_FRAME_KEY)} canManage={hasPermission(ctx, 'settings.manage')} />
    </>
  );
}
