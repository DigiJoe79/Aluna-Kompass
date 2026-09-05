import { requirePermission } from '@kompass/core';
import { getPage } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { GapCounter } from '@/components/gap-counter';
import { PageHeader } from '@/components/page-header';
import { gapCount } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';
import { PageForm } from './page-form';

export default async function WebsitePageEdit(props: { params: Promise<{ key: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const { key } = await props.params;
  const page = await getPage(deps, ctx, key);
  if (!page.ok) notFound();
  const t = await getTranslations('website.pages');
  return (
    <>
      <PageHeader title={t(`keys.${page.value.key}`)} description={`/${page.value.key}`} actions={<GapCounter count={gapCount(page.value as unknown as Record<string, unknown>, ['title', 'lede', 'body', 'metaDescription'])} />} />
      <PageForm page={page.value} />
    </>
  );
}
