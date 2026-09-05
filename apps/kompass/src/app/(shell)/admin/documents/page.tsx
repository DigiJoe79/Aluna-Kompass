import { requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';

export default async function DocumentsPage() {
  const { ctx } = await requireSession();
  if (requirePermission(ctx, 'documents.view')) return <ForbiddenCard permission="documents.view" />;
  const t = await getTranslations('placeholders.documents');
  return (
    <>
      <PageHeader title={t('title')} />
      <EmptyState title={t('emptyTitle')} text={t('emptyText')} />
    </>
  );
}
