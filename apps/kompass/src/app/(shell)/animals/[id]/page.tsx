import { hasPermission, readSetting, requirePermission } from '@kompass/core';
import { getAnimal, listAnimalOrigins, listAnimals, listProposals, MAX_ANIMAL_PHOTOS, PHOTO_FRAME_KEY, photoFrameStyle, PROFILE_URL_KEY, profileUrl, type PhotoFrame } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { queuePosition } from '@/lib/queue-position';
import { requireSession } from '@/lib/request-context';
import { RelatedDocuments } from '@/components/related-documents';
import { AnimalForm } from '../animal-form';
import { AnimalActions } from '../animal-actions';
import { animalListInput, formTab, listQueryString, type AnimalListQuery, type AnimalQueue } from '../list-params';
import { ProfileExportButton } from '../profile-export-button';
import { QueueNav } from '../queue-nav';

export default async function AnimalEditPage(props: { params: Promise<{ id: string }>; searchParams: Promise<AnimalListQuery & { tab?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.view')) return <Page width="standard"><ForbiddenCard permission="animals.view" /></Page>;
  const { id } = await props.params;
  const q = await props.searchParams;
  const t = await getTranslations('animals.list');
  const c = await getTranslations('common');
  // Die Liste, aus der man kam, reist in der Adresse mit: Der Rückweg führt in dieselbe Auswahl.
  const query = listQueryString(q);
  const back = { href: `/animals${query ? `?${query}` : ''}`, label: c('backToList') };
  // Der Ausschnitt, in dem die Webseite das Hauptfoto zeigt – die Kacheln der Maske stehen darin.
  const photoFrame = photoFrameStyle(readSetting<PhotoFrame>(deps, PHOTO_FRAME_KEY));
  if (id === 'new') return (<Page width="standard" header={<PageHeader title={t('create')} back={back} />}><AnimalForm animal={null} locales={deps.locales()} queue={null} initialTab="profile" backHref={back.href} photoFrame={photoFrame} maxPhotos={MAX_ANIMAL_PHOTOS} /></Page>);
  const animal = await getAnimal(deps, ctx, id);
  if (!animal.ok) notFound();
  // Die Warteschlange ist die gefilterte, sortierte Liste – dieselbe Abfrage wie dort, kein eigener Zustand.
  let queue: AnimalQueue | null = null;
  if (query) {
    const list = await listAnimals(deps, ctx, animalListInput(q));
    queue = { query, position: list.ok ? queuePosition(list.value.animals.map((a) => a.id), id) : null };
  }
  // Die Adresse aus der Einstellung statt eines festen Pfads: Den Pfad legt das Template fest (Spec § 9.2).
  const address = profileUrl(readSetting<string>(deps, PROFILE_URL_KEY), animal.value.slug) ?? undefined;
  const exportButton = hasPermission(ctx, 'documents.export') ? <ProfileExportButton ids={[animal.value.id]} /> : null;
  const recordActions = requirePermission(ctx, 'animals.manage') ? null : <AnimalActions id={animal.value.id} name={animal.value.name} />;
  // Herkunft und offener Vorschlag (Board Vorschläge 7a); den Vorschlag sieht nur, wer ihn prüfen darf.
  const origins = await listAnimalOrigins(deps, ctx, id);
  const open = hasPermission(ctx, 'animals.manage') ? await listProposals(deps, ctx, { state: 'open', animalId: id }) : null;
  const openProposal = open?.ok ? (open.value.proposals[0] ?? null) : null;
  const actions = exportButton || queue || recordActions ? <>{exportButton}{queue ? <QueueNav key={animal.value.id} queue={queue} /> : null}{recordActions}</> : undefined;
  return (
    <Page width="standard" header={<PageHeader title={animal.value.name} description={address} back={back} actions={actions} />}>
      {/* `key`: Beim Wechsel zum nächsten Hund behielte React sonst den Zustand der Felder und der Fotos. */}
      <AnimalForm key={animal.value.id} animal={animal.value} locales={deps.locales()} queue={queue} initialTab={formTab(q.tab)} backHref={back.href} photoFrame={photoFrame} maxPhotos={MAX_ANIMAL_PHOTOS} origins={origins.ok ? origins.value : []} openProposal={openProposal} />
      <div className="mt-6">
        <RelatedDocuments deps={deps} ctx={ctx} entityType="animal" entityId={animal.value.id} />
      </div>
    </Page>
  );
}
