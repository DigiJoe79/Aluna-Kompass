import { requirePermission } from '@kompass/core';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { SortableHead } from '@/components/sortable-head';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/request-context';
import { readSort } from '@/lib/sort';
import { reorderProjectsAction, setProjectPublishedAction } from './actions';
import { PROJECT_SORT_FIELDS, sortProjects } from './sort';

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ sort?: string; dir?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'projects.view')) return <Page width="full"><ForbiddenCard permission="projects.view" /></Page>;
  const t = await getTranslations('projects');
  const result = await listProjects(deps, ctx);
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="projects.view" /></Page>;
  // Ohne `?sort=` gilt die eigene Reihenfolge, wie die Webseite sie zeigt, und die Pfeile stehen da.
  // Mit Sortierung fehlen sie: Sie würden eine Reihenfolge verschieben, die man gerade nicht sieht.
  const sort = readSort(await searchParams, PROJECT_SORT_FIELDS);
  const rows = sortProjects(result.value, sort);
  const ids = result.value.map((p) => p.id);
  return (
    <Page width="full" header={<PageHeader title={t('title')} actions={<Link href="/projects/new" className={buttonVariants()}>{t('create')}</Link>} />}>
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <>
          {sort ? (
            <p className="mb-3 text-[13px]">
              <Link href="/projects" className="text-link underline">{t('ownOrder')}</Link>
            </p>
          ) : null}
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead field="name" label={t('columns.name')} />
                  <SortableHead field="type" label={t('columns.type')} />
                  <TableHead>{t('columns.links')}</TableHead>
                  <TableHead>{t('columns.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell><RowLink href={`/projects/${p.id}`}>{p.name.de || p.slug}</RowLink></TableCell>
                    <TableCell><StatusBadge tone="neutral">{t(`types.${p.type}`)}</StatusBadge></TableCell>
                    <TableCell className="text-[12px] text-muted-ink">{p.externalLinks.length > 0 ? p.externalLinks.map((l) => l.label).join(', ') : '—'}</TableCell>
                    <TableCell><PublishSwitch id={p.id} isPublished={p.isPublished} action={setProjectPublishedAction} /></TableCell>
                    <TableCell className="text-right">{sort ? null : <ReorderButtons ids={ids} index={ids.indexOf(p.id)} action={reorderProjectsAction} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Page>
  );
}
