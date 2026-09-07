import { requirePermission } from '@kompass/core';
import { getAnimal } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { AnimalForm } from '../animal-form';

export default async function AnimalEditPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.view')) return <ForbiddenCard permission="animals.view" />;
  const { id } = await props.params;
  const t = await getTranslations('animals.list');
  if (id === 'new') return (<><PageHeader title={t('create')} /><AnimalForm animal={null} locales={deps.locales()} /></>);
  const animal = await getAnimal(deps, ctx, id);
  if (!animal.ok) notFound();
  return (<><PageHeader title={animal.value.name} description={`/hunde/${animal.value.slug}/`} /><AnimalForm animal={animal.value} locales={deps.locales()} /></>);
}
