import { hasPermission, readSetting, requirePermission } from '@kompass/core';
import { countUnreadDocuments, dispatchChannels, listDocumentFolders, listDocumentRules, listDocumentTypes, listSnippets } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { DispatchChannelsPanel } from './dispatch-channels-panel';
import { FoldersPanel } from './folders-panel';
import { SnippetsPanel } from './snippets-panel';
import { RulesPanel } from './rules-panel';
import { TextPanel } from './text-panel';
import { TypesPanel } from './types-panel';

export default async function AdminDmsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.manage')) return <ForbiddenCard permission="dms.manage" />;

  const t = await getTranslations('dms.admin');

  const [typesRes, foldersRes, rulesRes, probe] = await Promise.all([
    listDocumentTypes(deps, ctx, { includeInactive: true }),
    listDocumentFolders(deps, ctx),
    listDocumentRules(deps, ctx, { includeInactive: true }),
    deps.textExtraction.probe(),
  ]);

  const currentLanguages = (readSetting(deps, 'dms.ocrLanguages') as string | null) ?? 'deu+eng';
  const availableLanguages = probe.ok ? probe.languages : null;

  const unreadRes = countUnreadDocuments(deps, ctx);
  const openCount = unreadRes.ok ? unreadRes.value : 0;
  const canManageSettings = hasPermission(ctx, 'settings.manage');

  const snippetsRes = await listSnippets(deps, ctx, { includeInactive: true });
  const snippets = snippetsRes.ok ? snippetsRes.value : [];
  const channels = dispatchChannels(deps);

  const types = typesRes.ok ? typesRes.value : [];
  const folders = foldersRes.ok ? foldersRes.value.map((f) => f.path) : [];
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

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="space-y-6">
        <TypesPanel types={types} folders={folders} />
        <RulesPanel rules={rules} types={types} folders={folders} />
        <FoldersPanel folders={folders} />
        <SnippetsPanel snippets={snippets} />
        <DispatchChannelsPanel channels={channels} canManageSettings={canManageSettings} />
        <TextPanel
          currentLanguages={currentLanguages}
          availableLanguages={availableLanguages}
          openCount={openCount}
          canManageSettings={canManageSettings}
        />
      </div>
    </>
  );
}

