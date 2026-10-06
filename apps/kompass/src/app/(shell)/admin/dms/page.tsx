import { hasPermission, isModuleEnabled, readSetting, requirePermission } from '@kompass/core';
import { countDocumentsOfType, countUnreadDocuments, dispatchChannels, documentTypeProvisionedBy, isDefaultType, listDocumentAreas, listDocumentFolders, listDocumentRules, listDocumentTypes, listSnippets } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { PanelNav, panelFromQuery } from '@/components/panel-nav';
import { requireSession } from '@/lib/request-context';
import { DispatchChannelsPanel } from './dispatch-channels-panel';
import { FoldersPanel } from './folders-panel';
import { SnippetsPanel } from './snippets-panel';
import { RulesPanel } from './rules-panel';
import { TextPanel } from './text-panel';
import { TypesPanel } from './types-panel';

const PANELS = ['types', 'rules', 'folders', 'snippets', 'channels', 'text'] as const;

/** Folder-Pfade für die Auswahlfelder der Arten und Regeln. */
async function loadFolderPaths(...args: Parameters<typeof listDocumentFolders>): Promise<string[]> {
  const foldersRes = await listDocumentFolders(...args);
  return foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];
}

export default async function AdminDmsPage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'dms')) return <Page width="standard"><ModuleInactiveCard namespace="dms.common" /></Page>;
  if (requirePermission(ctx, 'dms.manage')) return <Page width="standard"><ForbiddenCard permission="dms.manage" /></Page>;

  const t = await getTranslations('dms.admin');
  const panel = panelFromQuery((await searchParams).panel, PANELS, 'types');
  const canManageSettings = hasPermission(ctx, 'settings.manage');

  // Nur der gewählte Bereich lädt, was er braucht; die Zählung je Art ist der teure Teil.
  let content: React.ReactNode = null;
  if (panel === 'types') {
    const [typesRes, folders, areasRes] = await Promise.all([
      listDocumentTypes(deps, ctx, { includeInactive: true }),
      loadFolderPaths(deps, ctx),
      // Die Auswahl „Schutzbereich“ gibt es nur, wenn ein Modul einen Bereich anmeldet.
      listDocumentAreas(deps, ctx),
    ]);
    const rawTypes = typesRes.ok ? typesRes.value : [];
    // Das Panel bekommt einfache Daten: Bereiche, und je Art die Zahl der Dokumente,
    // die ein Wechsel betrifft (`null`, wenn der Aufrufer sie nicht zählen darf).
    const areas = areasRes.ok ? areasRes.value.map(({ key, permission, held }) => ({ key, permission, held })) : [];
    const types = await Promise.all(
      rawTypes.map(async (type) => {
        // Immer gezählt (nicht nur unter einem Bereich): „Löschen“ am Panel braucht die
        // Zahl für jede Art, um den Knopf nur zu zeigen, wenn er wirklich greift (Task 4).
        const counted = await countDocumentsOfType(deps, ctx, { key: type.key });
        const areaCount = counted.ok ? counted.value.count : null;
        // Die vier Sperren des Dienstes vorab geprüft, damit der Knopf nichts verspricht, was scheitern würde.
        const deletable = areaCount === 0 && !type.ownerModule && !documentTypeProvisionedBy(deps.db, type.key) && !isDefaultType(deps, type.key);
        return { ...type, areaCount, deletable };
      }),
    );
    content = <TypesPanel types={types} folders={folders} areas={areas} />;
  } else if (panel === 'rules') {
    const [rulesRes, selectableTypesRes, folders] = await Promise.all([
      listDocumentRules(deps, ctx, { includeInactive: true }),
      listDocumentTypes(deps, ctx, { selectable: true }),
      loadFolderPaths(deps, ctx),
    ]);
    const rules = rulesRes.ok
      ? rulesRes.value.map((r) => ({
          id: r.id,
          matchField: r.matchField as 'filename' | 'senderName',
          matchContains: r.matchContains,
          thenTypeKey: r.thenTypeKey,
          thenFolder: r.thenFolder,
          isActive: r.isActive,
          sortOrder: r.sortOrder,
        }))
      : [];
    content = <RulesPanel rules={rules} types={selectableTypesRes.ok ? selectableTypesRes.value : []} folders={folders} />;
  } else if (panel === 'folders') {
    content = <FoldersPanel />;
  } else if (panel === 'snippets') {
    const snippetsRes = await listSnippets(deps, ctx, { includeInactive: true });
    content = <SnippetsPanel snippets={snippetsRes.ok ? snippetsRes.value : []} />;
  } else if (panel === 'channels') {
    content = <DispatchChannelsPanel channels={dispatchChannels(deps)} canManageSettings={canManageSettings} />;
  } else {
    const probe = await deps.textExtraction.probe();
    const unreadRes = countUnreadDocuments(deps, ctx);
    content = (
      <TextPanel
        currentLanguages={(readSetting(deps, 'dms.ocrLanguages') as string | null) ?? 'deu+eng'}
        availableLanguages={probe.ok ? probe.languages : null}
        openCount={unreadRes.ok ? unreadRes.value : 0}
        canManageSettings={canManageSettings}
      />
    );
  }

  const tabs = await getTranslations('dms.admin.panels');
  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <div className="space-y-5">
        <PanelNav
          basePath="/admin/dms"
          panels={PANELS}
          active={panel}
          labels={Object.fromEntries(PANELS.map((k) => [k, tabs(k)])) as Record<(typeof PANELS)[number], string>}
          ariaLabel={t('tabsLabel')}
        />
        {content}
      </div>
    </Page>
  );
}
