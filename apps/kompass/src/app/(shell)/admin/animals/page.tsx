import { hasPermission, isModuleEnabled, listMediaFolders, readSetting, requirePermission } from '@kompass/core';
import { PHOTO_FRAME_KEY, PROFILE_URL_KEY, PROPOSAL_PHOTO_FOLDER_KEY, PROPOSAL_STACK_KEY, PROPOSALS_ENABLED_KEY, REVIEW_ON_MCP_WRITE_KEY, type PhotoFrame } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { AnimalSettingsPanel } from './settings-panel';

/** Einstellungen des Tiermoduls: Ausschnitt des Hauptfotos, Adresse des Online-Profils, Vorschläge von Quellen und Prüfung. */
export default async function AdminAnimalsPage() {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'animals')) return <Page width="standard"><ModuleInactiveCard namespace="animals.common" /></Page>;
  if (requirePermission(ctx, 'settings.manage')) return <Page width="standard"><ForbiddenCard permission="settings.manage" /></Page>;
  const t = await getTranslations('animals.admin');
  // Die Ordner der Mediathek für die Wahl des Fotoordners; ohne Recht auf die Mediathek `null` — das Feld zeigt dann nur den Ort.
  const listed = await listMediaFolders(deps, ctx);
  const folders = listed.ok ? listed.value.map((f) => ({ path: f.path, count: f.assetCount })) : null;
  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <AnimalSettingsPanel
        initial={{
          frame: readSetting<PhotoFrame>(deps, PHOTO_FRAME_KEY),
          profileUrl: readSetting<string>(deps, PROFILE_URL_KEY),
          proposalsEnabled: readSetting<boolean>(deps, PROPOSALS_ENABLED_KEY) === true,
          reviewOnMcpWrite: readSetting<boolean>(deps, REVIEW_ON_MCP_WRITE_KEY) === true,
          photoFolder: readSetting<string>(deps, PROPOSAL_PHOTO_FOLDER_KEY) ?? '',
          stackEnabled: readSetting<boolean>(deps, PROPOSAL_STACK_KEY) === true,
        }} folders={folders} canManage={hasPermission(ctx, 'settings.manage')} />
    </Page>
  );
}
