import { requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';

export default async function BackupPage() {
  const { ctx } = await requireSession();
  if (requirePermission(ctx, 'backup.export')) return <ForbiddenCard permission="backup.export" />;
  const t = await getTranslations('placeholders.backup');
  return (
    <>
      <PageHeader title={t('title')} />
      <EmptyState title={t('emptyTitle')} text={t('emptyText')} />
    </>
  );
}
