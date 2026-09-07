import { requirePermission } from '@kompass/core';
import { listFaqs } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { reorderFaqsAction, setFaqPublishedAction } from './actions';
import { FaqDialog } from './faq-form';

export default async function FaqsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const t = await getTranslations('website.faqs');
  const result = await listFaqs(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="website.view" />;
  const ids = result.value.map((f) => f.id);
  const locales = deps.locales();
  const leading = locales[0] ?? 'de';
  return (
    <>
      <PageHeader title={t('title')} actions={<FaqDialog faq={null} trigger={<Button>{t('create')}</Button>} locales={locales} />} />
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.question')}</th><th className="px-4">{t('columns.category')}</th><th className="px-4">{t('columns.status')}</th><th className="px-4" /></tr></thead>
            <tbody>
              {result.value.map((f, i) => (
                <tr key={f.id} className={`h-[52px] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`}>
                  <td className="px-4 font-semibold text-ink">{f.question[leading] ?? f.question.de ?? ''}</td>
                  <td className="px-4"><StatusBadge tone="neutral">{f.category[leading] ?? f.category.de ?? ''}</StatusBadge></td>
                  <td className="px-4"><PublishSwitch id={f.id} isPublished={f.isPublished} action={setFaqPublishedAction} /></td>
                  <td className="px-4 text-right"><span className="inline-flex items-center gap-1"><FaqDialog faq={f} trigger={<Button variant="ghost" size="sm">{t('edit')}</Button>} locales={locales} /><ReorderButtons ids={ids} index={i} action={reorderFaqsAction} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
