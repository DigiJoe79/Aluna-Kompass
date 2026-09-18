import { requirePermission } from '@kompass/core';
import { listAnimals } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { setAnimalPublishedAction } from './actions';

export default async function AnimalsPage(props: { searchParams: Promise<{ status?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.view')) return <ForbiddenCard permission="animals.view" />;
  const { status } = await props.searchParams;
  const t = await getTranslations('animals.list');
  const f = await getTranslations('animals.form');
  const result = await listAnimals(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="animals.view" />;
  const animals = status ? result.value.filter((a) => a.status === status) : result.value;
  return (
    <>
      <PageHeader title={t('title')} actions={<Link href="/animals/new" className={buttonVariants()}>{t('create')}</Link>} />
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
              <tr className="h-9">
                <th className="px-4">{t('columns.animal')}</th>
                <th className="px-4">{t('columns.status')}</th>
                <th className="px-4">{t('columns.flags')}</th>
                <th className="px-4">{t('columns.location')}</th>
                <th className="px-4 text-right">{t('columns.published')}</th>
              </tr>
            </thead>
            <tbody>
              {animals.map((a, i) => {
                const primary = a.photos.find((p) => p.isPrimary) ?? a.photos[0];
                return (
                  <tr key={a.id} className={`h-[52px] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`}>
                    <td className="px-4">
                      <span className="flex items-center gap-3">
                        {primary ? <img src={`/media/${primary.assetId}`} alt="" className="size-9 rounded-full object-cover" /> : <span className="size-9 rounded-full bg-surface-2" aria-hidden />}
                        <Link href={`/animals/${a.id}`} className="font-semibold text-link underline">{a.name}</Link>
                      </span>
                    </td>
                    <td className="px-4">
                      <StatusBadge tone={a.status === 'adopted' ? 'success' : a.status === 'reserved' ? 'warning' : 'info'} dot>
                        {f(`status.${a.status}`)}
                      </StatusBadge>
                    </td>
                    <td className="px-4">
                      <span className="flex items-center gap-1.5">
                        {a.isEmergency ? <StatusBadge tone="error">{t('emergency')}</StatusBadge> : null}
                        {a.isSponsorable ? <StatusBadge tone="accent">{t('sponsorable')}</StatusBadge> : null}
                      </span>
                    </td>
                    <td className="px-4 text-ink-2">{f(`locations.${a.location}`)}</td>
                    <td className="px-4 text-right">
                      <PublishSwitch id={a.id} isPublished={a.isPublished} action={setAnimalPublishedAction} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
