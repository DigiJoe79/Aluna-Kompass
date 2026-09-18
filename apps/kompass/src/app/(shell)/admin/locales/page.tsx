import { listLocales, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { LocalesClient } from './locales-client';

export default async function LocalesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'settings.manage')) return <ForbiddenCard permission="settings.manage" />;
  const t = await getTranslations('admin.locales');
  const result = await listLocales(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="settings.manage" />;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <LocalesClient locales={result.value} />
    </>
  );
}
