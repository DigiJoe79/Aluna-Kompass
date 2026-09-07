import { requirePermission } from '@kompass/core';
import { getArticle } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ArticleForm } from '../article-form';

export default async function ArticleEditPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const { id } = await props.params;
  const t = await getTranslations('website.articles');
  const locales = deps.locales();
  const leading = locales[0] ?? 'de';
  if (id === 'new') return (<><PageHeader title={t('create')} /><ArticleForm article={null} locales={locales} /></>);
  const article = await getArticle(deps, ctx, id);
  if (!article.ok) notFound();
  return (<><PageHeader title={article.value.title[leading] || article.value.slug} description={`/wissenswertes/${article.value.slug}/`} /><ArticleForm article={article.value} locales={locales} /></>);
}
