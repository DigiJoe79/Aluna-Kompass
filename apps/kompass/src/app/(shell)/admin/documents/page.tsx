import { hasPermission, listDocuments, listUsers, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { CreateDocumentDialog } from './create-document-dialog';
import { DocumentList } from './document-list';
import { DocumentPreview } from './document-preview';

export default async function DocumentsPage(props: { searchParams: Promise<{ selected?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'documents.view')) return <ForbiddenCard permission="documents.view" />;
  const t = await getTranslations('documents');
  const { selected } = await props.searchParams;
  const result = await listDocuments(deps, ctx, { limit: 200 });
  if (!result.ok) return <ForbiddenCard permission="documents.view" />;
  const users = hasPermission(ctx, 'users.manage') ? await listUsers(deps, ctx) : null;
  const nameOf = (id: string) => (users?.ok ? users.value.find((u) => u.id === id)?.name ?? null : null);
  const rows = result.value.documents.map((d) => ({ ...d, createdByName: nameOf(d.createdByUserId), title: String((d.inputSnapshot as { title?: string }).title ?? d.number) }));
  const canCreate = hasPermission(ctx, 'documents.create');
  const templates = [...deps.registry.documentTemplates.values()].map((tpl) => ({ key: tpl.key, enabled: !tpl.permission || hasPermission(ctx, tpl.permission), reason: tpl.permission && !hasPermission(ctx, tpl.permission) ? t('create.missingPermission', { permission: tpl.permission }) : undefined }));
  const selectedDoc = rows.find((d) => d.id === selected) ?? null;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={canCreate ? <CreateDocumentDialog templates={templates} /> : null} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {rows.length === 0 ? <EmptyState title={t('empty.title')} text={t('empty.text')} /> : <DocumentList documents={rows} selectedId={selectedDoc?.id ?? null} canCreate={canCreate} />}
        {selectedDoc ? <DocumentPreview id={selectedDoc.id} number={selectedDoc.number} /> : null}
      </div>
      <p className="mt-3 text-[12px] text-muted-ink">{t('footnote')}</p>
    </>
  );
}