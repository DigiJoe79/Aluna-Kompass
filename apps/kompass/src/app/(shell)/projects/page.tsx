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
import { buttonVariants } from '@/components/ui/button';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/request-context';
import { readSort } from '@/lib/sort';
import { reorderProjectsAction, setProjectPublishedAction } from './actions';
import { PROJECT_SORT_FIELDS, sortProjects } from './sort';
import { Empty } from '@/components/empty-value';
import { nameOrEmpty } from '@/lib/name-or-empty';

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ sort?: string; dir?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'projects.view')) return <Page width="full"><ForbiddenCard permission="projects.view" /></Page>;
  const t = await getTranslations('projects');
  const tMuted = await getTranslations('common.muted');
  const tContent = await getTranslations('content');
  const result = await listProjects(deps, ctx);
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="projects.view" /></Page>;
  // Ohne `?sort=` gilt die eigene Reihenfolge, wie die Webseite sie zeigt, und die Pfeile stehen da.
  // Mit Sortierung fehlen sie: Sie würden eine Reihenfolge verschieben, die man gerade nicht sieht.
  const sort = readSort(await searchParams, PROJECT_SORT_FIELDS);
  const rows = sortProjects(result.value, sort);
  const ids = result.value.map((p) => p.id);
  const leading = deps.locales()[0] ?? 'de';
  return (
    <Page width="full" header={<PageHeader title={t('title')} actions={<Link href="/projects/new" className={buttonVariants()}>{t('create')}</Link>} />}>
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <>
          {sort ? (
            <p className="mb-3 text-meta">
              <Link href="/projects" className="text-link underline">{t('ownOrder')}</Link>
            </p>
          ) : null}
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead col="title" field="name" label={t('columns.name')} />
                  <SortableHead col="meta" field="type" label={t('columns.type')} />
                  <TableHead>{t('columns.links')}</TableHead>
                  {/* Der Schalter meint die Veröffentlichung, nicht den Projektstatus (06 A2, 14 B15). */}
                  <TableHead col="status">{t('columns.website')}</TableHead>
                  {/* Kopf für Vorleser über den Reihenfolge-Pfeilen (06 B8). */}
                  <TableHead col="actions"><span className="sr-only">{t('columns.order')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  // Abgeschlossen ist die gedämpfte Zeile mit Marke hinter dem Namen, keine Statusspalte (Joe 11.8, 061).
                  <TableRow key={p.id} muted={p.status === 'completed' ? tMuted('closed') : undefined}>
                    <TableCell col="title"><RowLink href={`/projects/${p.id}`}>{nameOrEmpty(p.name[leading], p.slug)}</RowLink></TableCell>
                    {/* Typ ist eine Eigenschaft, kein Zustand: Text statt Marke (06 B12). */}
                    <TableCell col="meta" className="text-ink-2">
                      {t(`types.${p.type}`)}
                      {/* 061: Am Telefon Text statt Schalter in der Unterzeile; geschaltet wird am Projekt. Kein Layout-Test. */}
                      {p.isPublished ? <span className="md:hidden"> · {tContent('onWebsite')}</span> : null}
                    </TableCell>
                    <TableCell className="text-hint text-muted-ink">{p.externalLinks.length > 0 ? p.externalLinks.map((l) => l.label).join(', ') : <Empty />}</TableCell>
                    <TableCell col="status"><span className="max-md:hidden"><PublishSwitch id={p.id} isPublished={p.isPublished} action={setProjectPublishedAction} /></span></TableCell>
                    <TableCell col="actions" className="text-right">{sort ? null : <ReorderButtons ids={ids} index={ids.indexOf(p.id)} action={reorderProjectsAction} />}</TableCell>
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
