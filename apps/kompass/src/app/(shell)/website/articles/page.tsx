import { requirePermission } from '@kompass/core';
import { listArticles } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { GapCounter } from '@/components/gap-counter';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { gapCount } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';
import { reorderArticlesAction, setArticlePublishedAction } from './actions';

export default async function ArticlesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const t = await getTranslations('website.articles');
  const result = await listArticles(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="website.view" />;
  const ids = result.value.map((a) => a.id);
  const locales = deps.locales();
  const leading = locales[0]!;
  return (
    <>
      <PageHeader title={t('title')} actions={<Link href="/website/articles/new" className={buttonVariants()}>{t('create')}</Link>} />
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.title')}</th><th className="px-4">{t('columns.slug')}</th><th className="px-4">{t('columns.gaps')}</th><th className="px-4">{t('columns.status')}</th><th className="px-4" /></tr></thead>
            <tbody>
              {result.value.map((a, i) => (
                <tr key={a.id} className={`h-[var(--row-h)] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`}>
                  <td className="px-4 font-semibold"><Link href={`/website/articles/${a.id}`} className="text-link underline">{a.title[leading] || a.slug}</Link></td>
                  <td className="px-4 font-mono text-[12px] text-muted-ink">{a.slug}</td>
                  <td className="px-4"><GapCounter count={gapCount(a as unknown as Record<string, unknown>, ['title', 'lede', 'body'], locales)} /></td>
                  <td className="px-4"><PublishSwitch id={a.id} isPublished={a.isPublished} action={setArticlePublishedAction} /></td>
                  <td className="px-4 text-right"><ReorderButtons ids={ids} index={i} action={reorderArticlesAction} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
