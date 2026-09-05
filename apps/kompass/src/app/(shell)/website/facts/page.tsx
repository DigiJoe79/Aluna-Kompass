import { isModuleEnabled, readAllSettings, requirePermission } from '@kompass/core';
import { listAnimals } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { FactsForm } from './facts-form';

export default async function FactsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.manage')) return <ForbiddenCard permission="website.manage" />;
  const t = await getTranslations('website.facts');
  const all = readAllSettings(deps);
  const initial = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('website.')));
  let animals: { slug: string; name: string }[] = [];
  let stories: { slug: string; name: string }[] = [];
  if (isModuleEnabled(deps, 'animals') && ctx.permissions.has('animals.view')) {
    const list = await listAnimals(deps, ctx);
    if (list.ok) {
      animals = list.value.filter((a) => a.status !== 'adopted' && a.isPublished).map((a) => ({ slug: a.slug, name: a.name }));
      stories = list.value.filter((a) => a.status === 'adopted' && a.isPublished).map((a) => ({ slug: a.slug, name: a.name }));
    }
  }
  return (<><PageHeader title={t('title')} description={t('description')} /><FactsForm initial={initial} animals={animals} stories={stories} /></>);
}
