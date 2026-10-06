import { hasPermission, requirePermission } from '@kompass/core';
import { activeTemplate, entryLabel, listEntries } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { ListClient } from './list-client';

export const dynamic = 'force-dynamic';

export default async function CollectionPage(props: { params: Promise<{ collection: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.view')) return <Page width="full"><ForbiddenCard permission="site.view" /></Page>;
  const { collection } = await props.params;
  const template = activeTemplate(deps);
  const col = template?.schema.collections[collection];
  if (!col) notFound();

  const result = await listEntries(deps, ctx, collection);
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="site.view" /></Page>;

  const canManage = hasPermission(ctx, 'site.manage');
  const t = await getTranslations('site.entries');
  const locales = deps.locales();
  const leading = locales[0] ?? 'de';

  const rows = result.value.map((entry) => ({ id: entry.id, label: entryLabel(col, entry, leading), isPublished: entry.isPublished }));

  return (
    <Page
      width="full"
      header={
        <PageHeader
          title={col.label}
          actions={canManage ? <Link href={`/site/c/${collection}/new`} className={buttonVariants()}>{t('new')}</Link> : undefined}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyState title={col.label} text={t('count', { n: 0 })} />
      ) : (
        <ListClient
          collection={collection}
          rows={rows}
          publishable={col.publishable}
          sortable={col.sortable}
          canManage={canManage}
        />
      )}
    </Page>
  );
}
