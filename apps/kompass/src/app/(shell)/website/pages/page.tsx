import { requirePermission } from '@kompass/core';
import { listPages } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { GapCounter } from '@/components/gap-counter';
import { PageHeader } from '@/components/page-header';
import { gapCount } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export default async function WebsitePagesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const t = await getTranslations('website.pages');
  const pages = await listPages(deps, ctx);
  if (!pages.ok) return <ForbiddenCard permission="website.view" />;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <table className="w-full text-[14px]">
          <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.page')}</th><th className="px-4">{t('columns.key')}</th><th className="px-4">{t('columns.title')}</th><th className="px-4">{t('columns.gaps')}</th></tr></thead>
          <tbody>
            {pages.value.map((p, i) => (
              <tr key={p.key} className={`h-[var(--row-h)] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`} aria-label={t(`keys.${p.key}`)}>
                <td className="px-4 font-semibold"><Link href={`/website/pages/${p.key}`} className="text-link underline">{t(`keys.${p.key}`)}</Link></td>
                <td className="px-4 font-mono text-[12px] text-muted-ink">{p.key}</td>
                <td className="px-4 text-ink-2">{p.title.de || '—'}</td>
                <td className="px-4"><GapCounter count={gapCount(p as unknown as Record<string, unknown>, ['title', 'lede', 'body', 'metaDescription'])} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
