import { requirePermission } from '@kompass/core';
import { listTeam } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { reorderTeamAction, setTeamPublishedAction } from './actions';
import { TeamMemberDialog } from './team-form';

export default async function TeamPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const t = await getTranslations('website.team');
  const result = await listTeam(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="website.view" />;
  const locales = deps.locales();
  const leading = locales[0] ?? 'de';
  const ids = result.value.map((m) => m.id);
  return (
    <>
      <PageHeader title={t('title')} actions={<TeamMemberDialog member={null} trigger={<Button>{t('create')}</Button>} locales={locales} />} />
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.member')}</th><th className="px-4">{t('columns.position')}</th><th className="px-4">{t('columns.status')}</th><th className="px-4" /></tr></thead>
            <tbody>
              {result.value.map((m, i) => (
                <tr key={m.id} className={`h-[52px] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`}>
                  <td className="px-4"><span className="flex items-center gap-3">{m.photoAssetId ? <img src={`/media/${m.photoAssetId}`} alt="" className="size-9 rounded-full object-cover" /> : <span className="size-9 rounded-full bg-surface-2" aria-hidden />}<span className="font-semibold">{m.name}</span></span></td>
                  <td className="px-4 text-ink-2">{m.position[leading] ?? ''}</td>
                  <td className="px-4"><PublishSwitch id={m.id} isPublished={m.isPublished} action={setTeamPublishedAction} /></td>
                  <td className="px-4 text-right"><span className="inline-flex items-center gap-1"><TeamMemberDialog member={m} trigger={<Button variant="ghost" size="sm">{t('edit')}</Button>} locales={locales} /><ReorderButtons ids={ids} index={i} action={reorderTeamAction} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
