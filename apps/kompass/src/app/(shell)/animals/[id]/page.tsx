import { readSetting, requirePermission } from '@kompass/core';
import { getAnimal, listAnimals, PHOTO_FRAME_KEY, photoFrameStyle, type PhotoFrame } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { queuePosition } from '@/lib/queue-position';
import { requireSession } from '@/lib/request-context';
import { RelatedDocuments } from '@/components/related-documents';
import { AnimalForm } from '../animal-form';
import { DeleteAnimal } from '../delete-animal';
import { animalListInput, formTab, listQueryString, type AnimalListQuery, type AnimalQueue } from '../list-params';
import { QueueNav } from '../queue-nav';

export default async function AnimalEditPage(props: { params: Promise<{ id: string }>; searchParams: Promise<AnimalListQuery & { tab?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.view')) return <ForbiddenCard permission="animals.view" />;
  const { id } = await props.params;
  const q = await props.searchParams;
  const t = await getTranslations('animals.list');
  const c = await getTranslations('common');
  // Die Liste, aus der man kam, reist in der Adresse mit: Der Rückweg führt in dieselbe Auswahl.
  const query = listQueryString(q);
  const back = { href: `/animals${query ? `?${query}` : ''}`, label: c('backToList') };
  // Der Ausschnitt, in dem die Webseite das Hauptfoto zeigt – die Kacheln der Maske stehen darin.
  const photoFrame = photoFrameStyle(readSetting<PhotoFrame>(deps, PHOTO_FRAME_KEY));
  if (id === 'new') return (<><PageHeader title={t('create')} back={back} /><AnimalForm animal={null} locales={deps.locales()} queue={null} initialTab="profile" backHref={back.href} photoFrame={photoFrame} /></>);
  const animal = await getAnimal(deps, ctx, id);
  if (!animal.ok) notFound();
  // Die Warteschlange ist die gefilterte, sortierte Liste – dieselbe Abfrage wie dort, kein eigener Zustand.
  let queue: AnimalQueue | null = null;
  if (query) {
    const list = await listAnimals(deps, ctx, animalListInput(q));
    queue = { query, position: list.ok ? queuePosition(list.value.animals.map((a) => a.id), id) : null };
  }
  return (
    <>
      <PageHeader title={animal.value.name} description={`/hunde/${animal.value.slug}/`} back={back} actions={queue ? <QueueNav key={animal.value.id} queue={queue} /> : undefined} />
      {/* `key`: Beim Wechsel zum nächsten Hund behielte React sonst den Zustand der Felder und der Fotos. */}
      <AnimalForm key={animal.value.id} animal={animal.value} locales={deps.locales()} queue={queue} initialTab={formTab(q.tab)} backHref={back.href} photoFrame={photoFrame} />
      <div className="mt-6">
        <RelatedDocuments deps={deps} ctx={ctx} entityType="animal" entityId={animal.value.id} />
      </div>
      {requirePermission(ctx, 'animals.manage') ? null : <DeleteAnimal id={animal.value.id} name={animal.value.name} />}
    </>
  );
}
