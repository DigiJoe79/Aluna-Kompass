import { hasPermission, imagePlaces, readSetting, requirePermission } from '@kompass/core';
import { effectivePhotoFrame, getAnimal, listAnimalOrigins, listAnimals, listProposals, MAX_ANIMAL_PHOTOS, photoPixelSizes, PRIMARY_PHOTO_PLACE, PROFILE_URL_KEY, profileUrl } from '@kompass/module-animals';
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
  const nav = await getTranslations('nav');
  // Die Liste, aus der man kam, reist in der Adresse mit: Der Rückweg führt in dieselbe Auswahl.
  const query = listQueryString(q);
  const back = { href: `/animals${query ? `?${query}` : ''}`, label: nav('animals.list') };
  // Die Stellen der Webseite für die Fotos (Spec Ausschnitt für alle Bilder § 4): Hauptfoto aus dem Template, sonst die
  // Einstellung „Bildausschnitt“; die übrigen nach `animals.gallery`. Der Blickpunkt kommt immer aus der Einstellung.
  const { focusX, focusY } = effectivePhotoFrame(deps);
  const photoPlaces = { primary: imagePlaces(deps, PRIMARY_PHOTO_PLACE), gallery: imagePlaces(deps, 'animals.gallery'), focus: { focusX, focusY } };
  if (id === 'new') return (<Page width="standard" header={<PageHeader title={t('create')} back={back} />}><AnimalForm animal={null} locales={deps.locales()} queue={null} initialTab="profile" backHref={back.href} photoPlaces={photoPlaces} maxPhotos={MAX_ANIMAL_PHOTOS} /></Page>);
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
      <AnimalForm key={animal.value.id} animal={animal.value} locales={deps.locales()} queue={queue} initialTab={formTab(q.tab)} backHref={back.href} photoPlaces={photoPlaces} storyPlaces={imagePlaces(deps, 'animals.story')} photoSizes={photoPixelSizes(deps, [...animal.value.photos.map((p) => p.assetId), ...(animal.value.story ? [animal.value.story.beforeAssetId, animal.value.story.afterAssetId].filter((x): x is string => !!x) : [])])} maxPhotos={MAX_ANIMAL_PHOTOS} origins={origins.ok ? origins.value : []} openProposal={openProposal} />
      <div className="mt-6">
        <RelatedDocuments deps={deps} ctx={ctx} entityType="animal" entityId={animal.value.id} />
      </div>
    </Page>
  );
}
