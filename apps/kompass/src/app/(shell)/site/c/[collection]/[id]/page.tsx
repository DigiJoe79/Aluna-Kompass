import { mediaPixelSizes, requirePermission } from '@kompass/core';
import { activeTemplate, entryLabel, getEntry } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { PendingPublishLine } from '@/components/site/pending-publish';
import { requireSession } from '@/lib/request-context';
import { EntryActions } from '../entry-actions';
import { EntryForm } from '../entry-form';

export const dynamic = 'force-dynamic';

export default async function EntryPage(props: { params: Promise<{ collection: string; id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.manage')) return <Page width="standard"><ForbiddenCard permission="site.manage" /></Page>;
  const { collection, id } = await props.params;
  const template = activeTemplate(deps);
  const col = template?.schema.collections[collection];
  if (!col) notFound();

  const t = await getTranslations('site.entries');
  const back = { href: `/site/c/${collection}`, label: col.label };
  const locales = deps.locales();

  if (id === 'new') {
    return (
      // „Eintrag anlegen“, die Sammlung als Unterzeile (14 A2, Designer 2026-10-16): Einen Einzahl-Namen je Sammlung
      // liefert das Template nicht.
      <Page width="standard" header={<PageHeader title={t('create')} description={col.label} back={back} />}>
        <EntryForm collection={collection} fields={col.fields} hasSlug={col.slug} entry={null} locales={locales} collectionLabel={col.label} />
      </Page>
    );
  }

  const result = await getEntry(deps, ctx, id);
  if (!result.ok) notFound();

  return (
    <Page
      width="standard"
      header={<PageHeader title={col.label} back={back} actions={<EntryActions collection={collection} id={result.value.id} label={entryLabel(col, result.value, locales[0] ?? 'de')} publishable={col.publishable} />} />}
    >
      <PendingPublishLine href={`/site/c/${collection}/${result.value.id}`} className="-mt-3 mb-4 block" />
      <EntryForm
        collection={collection}
        fields={col.fields}
        hasSlug={col.slug}
        entry={{ id: result.value.id, slug: result.value.slug, data: result.value.data as Record<string, unknown>, updatedAt: result.value.updatedAt }}
        locales={locales}
        collectionLabel={col.label}
        mediaSizes={mediaPixelSizes(deps, result.value.data)}
      />
    </Page>
  );
}
