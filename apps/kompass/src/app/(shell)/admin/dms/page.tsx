import { requirePermission } from '@kompass/core';
import { listDocumentFolders, listDocumentRules, listDocumentTypes } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { FoldersPanel } from './folders-panel';
import { RulesPanel } from './rules-panel';
import { TypesPanel } from './types-panel';

export default async function AdminDmsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'dms.manage')) return <ForbiddenCard permission="dms.manage" />;

  const t = await getTranslations('dms.admin');

  const [typesRes, foldersRes, rulesRes] = await Promise.all([
    listDocumentTypes(deps, ctx, { includeInactive: true }),
    listDocumentFolders(deps, ctx),
    listDocumentRules(deps, ctx, { includeInactive: true }),
  ]);

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
      </div>
    </>
  );
}
