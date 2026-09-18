import { requirePermission } from '@kompass/core';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { reorderProjectsAction, setProjectPublishedAction } from './actions';

export default async function ProjectsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'projects.view')) return <ForbiddenCard permission="projects.view" />;
  const t = await getTranslations('projects');
  const result = await listProjects(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="projects.view" />;
  const ids = result.value.map((p) => p.id);
  return (
    <>
      <PageHeader title={t('title')} actions={<Link href="/projects/new" className={buttonVariants()}>{t('create')}</Link>} />
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.name')}</th><th className="px-4">{t('columns.type')}</th><th className="px-4">{t('columns.links')}</th><th className="px-4">{t('columns.status')}</th><th className="px-4" /></tr></thead>
            <tbody>
              {result.value.map((p, i) => (
                <tr key={p.id} className={`h-[52px] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`}>
                  <td className="px-4 font-semibold"><Link href={`/projects/${p.id}`} className="text-link underline">{p.name.de || p.slug}</Link></td>
                  <td className="px-4"><StatusBadge tone="neutral">{t(`types.${p.type}`)}</StatusBadge></td>
                  <td className="px-4 text-[12px] text-muted-ink">{p.externalLinks.length > 0 ? p.externalLinks.map((l) => l.label).join(', ') : '—'}</td>
                  <td className="px-4"><PublishSwitch id={p.id} isPublished={p.isPublished} action={setProjectPublishedAction} /></td>
                  <td className="px-4 text-right"><ReorderButtons ids={ids} index={i} action={reorderProjectsAction} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
