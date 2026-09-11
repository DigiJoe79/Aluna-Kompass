import { requirePermission } from '@kompass/core';
import { activeTemplate, listEntries, widgetOf } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { ListClient } from './list-client';

export const dynamic = 'force-dynamic';

export default async function CollectionPage(props: { params: Promise<{ collection: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.view')) return <ForbiddenCard permission="site.view" />;
  const { collection } = await props.params;
  const template = activeTemplate(deps);
  const col = template?.schema.collections[collection];
  if (!col) notFound();

  const result = await listEntries(deps, ctx, collection);
  if (!result.ok) return <ForbiddenCard permission="site.view" />;

  const t = await getTranslations('site.entries');
  const locales = deps.locales();
  const leading = locales[0] ?? 'de';
  const labelField = Object.entries(col.fields).find(([, f]) => ['text', 'localized', 'markdown'].includes(widgetOf(f)))?.[0];

  const rows = result.value.map((entry) => {
    const data = entry.data as Record<string, unknown>;
    const raw = labelField ? data[labelField] : undefined;
    const label =
      typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? String((raw as Record<string, string>)[leading] ?? '') : '';
    return { id: entry.id, label: label || entry.slug || entry.id, isPublished: entry.isPublished };
  });

  return (
    <>
      <PageHeader
        title={col.label}
        actions={<Link href={`/site/c/${collection}/new`} className={buttonVariants()}>{t('new')}</Link>}
      />
      {rows.length === 0 ? (
        <EmptyState title={col.label} text={t('count', { n: 0 })} />
      ) : (
        <ListClient
          collection={collection}
          rows={rows}
          publishable={col.publishable}
          sortable={col.sortable}
        />
      )}
    </>
  );
}
