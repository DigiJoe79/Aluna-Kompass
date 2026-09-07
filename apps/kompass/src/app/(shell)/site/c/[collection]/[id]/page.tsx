import { requirePermission } from '@kompass/core';
import { activeTemplate, getEntry } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { EntryForm } from '../entry-form';

export const dynamic = 'force-dynamic';

export default async function EntryPage(props: { params: Promise<{ collection: string; id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.manage')) return <ForbiddenCard permission="site.manage" />;
  const { collection, id } = await props.params;
  const template = activeTemplate(deps);
  const col = template?.schema.collections[collection];
  if (!col) notFound();

  const t = await getTranslations('site.entries');
  const locales = deps.locales();

  if (id === 'neu') {
    return (
      <>
        <PageHeader title={`${col.label} — ${t('new')}`} />
        <EntryForm collection={collection} fields={col.fields} hasSlug={col.slug} entry={null} locales={locales} />
      </>
    );
  }

  const result = await getEntry(deps, ctx, id);
  if (!result.ok) notFound();

  return (
    <>
      <PageHeader title={col.label} />
      <EntryForm
        collection={collection}
        fields={col.fields}
        hasSlug={col.slug}
        entry={{ id: result.value.id, slug: result.value.slug, data: result.value.data as Record<string, unknown> }}
        locales={locales}
      />
    </>
  );
}
