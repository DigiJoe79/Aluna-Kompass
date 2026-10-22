'use client';

import type { AnimalListItem } from '@kompass/module-animals';
import { Inbox, PawPrint } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, selectFilter } from '@/components/filter-bar';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { SelectionBar } from '@/components/selection-bar';
import { SortableHead } from '@/components/sortable-head';
import { Empty } from '@/components/empty-value';
import { StatusBadge, isNormalInList, statusTone } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { MutedMark, RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchField } from '@/components/search-field';
import { ViewTabs } from '@/components/view-tabs';
import { listKeyOf, useListSelection } from '@/lib/use-list-selection';
import { useUrlFilters } from '@/lib/use-url-filters';
import { setAnimalPublishedAction } from './actions';
import { LIST_LOCATIONS, LIST_STATUSES, listQueryString } from './list-params';
import { ProfileExportButton } from './profile-export-button';
import type { AnimalView } from './view-tabs';

type Filters = { text: string; status: string; location: string; published: string };

export function AnimalList({
  animals,
  total,
  reviewPending,
  tabCounts,
  canExport,
  views,
  openProposals,
  proposalAnimalIds,
}: {
  animals: AnimalListItem[];
  total: number;
  reviewPending: number;
  /** Mit den Filtern der Leiste gezählt, ohne die Sicht — was ein Klick auf den Reiter zeigen würde. */
  tabCounts: { all: number; reviewPending: number };
  canExport: boolean;
  /** Welche Reiter es gibt (`animalViewTabs`); nur „Alle“ → keine Reiter. */
  views: readonly AnimalView[];
  /** Ungefiltert, alle offenen Vorschläge (Ausnahme MUSTER § L). */
  openProposals: number;
  /** Hunde mit offenem Vorschlag → Marke „Vorschlag“ (Board 1c). */
  proposalAnimalIds: readonly string[];
}) {
  const t = useTranslations('animals.list');
  const f = useTranslations('animals.form');
  const c = useTranslations('content');
  const dates = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  // Gefiltert wird im Dienst (`listAnimals`); die Felder hier setzen nur die
  // Query-Parameter, dieselbe Trennung wie in der Kontaktliste.
  const [filters, setFilters] = useUrlFilters<Filters>({
    text: params.get('text') ?? '',
    status: params.get('status') ?? '',
    location: params.get('location') ?? '',
    published: params.get('published') ?? '',
  });
  const review = params.get('review') === '1';
  const current = Object.fromEntries(params);

  // Aus allen Feldern zusammen, nicht als Patch auf `params` — sonst geht eine
  // Änderung verloren, wenn zwei Filter im selben Render umgestellt werden.
  // Umschalter und Sortierung sind keine Filter, sie überleben jeden Wechsel.
  const applyFilters = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    const qs = listQueryString({ ...merged, text: merged.text.trim(), review: current.review, sort: current.sort, dir: current.dir });
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  // Der Umschalter behält die Filter. „Prüfung offen“ lässt die Sortierung
  // fallen: Ohne eigene Wahl steht oben, was am längsten wartet.
  const viewHref = (next: { review?: string; sort?: string; dir?: string }) => {
    const qs = listQueryString({ ...current, ...next });
    return qs ? `${pathname}?${qs}` : pathname;
  };
  // Der Weg ins Profil nimmt die Auswahl mit, damit die Maske zurück und weiter findet.
  const listQs = listQueryString(current);
  // Wie in der Akte: Ein Filterwechsel ist eine neue Liste und fängt leer an; „alle“ meint die gezeigten Zeilen.
  const selection = useListSelection(listKeyOf(params), animals);
  const selected = animals.filter((a) => selection.ids.has(a.id));
  const allSelected = animals.length > 0 && selected.length === animals.length;
  const proposalIds = new Set(proposalAnimalIds);
  const filtered = Boolean(filters.text.trim() || filters.status || filters.location || filters.published);
  const reset = () => applyFilters({ text: '', status: '', location: '', published: '' });

  return (
    <div className="flex flex-col gap-3">
      {/* Die Reiter behalten die Filter (`viewHref`); ihre Zahlen folgen den Filtern (MUSTER § L, Designer 2026-10-08). */}
      {/* „Vorschläge“ ist die benannte Ausnahme zu § L (Spec Vorschläge § 6, Board 1d): eine andere Liste, Filter reisen
          nicht mit, die Zahl zählt immer alle offenen. Ein einzelner Reiter wäre keiner (MUSTER § E). */}
      {views.length > 1 ? (
        <ViewTabs
          label={t('views')}
          current={review ? 'review' : 'all'}
          tabs={[
            { key: 'all', label: t('all'), href: viewHref({ review: undefined }), count: tabCounts.all },
            ...(views.includes('review') || review ? [{ key: 'review', label: t('reviewPending'), href: viewHref({ review: '1', sort: undefined, dir: undefined }), count: tabCounts.reviewPending }] : []),
            ...(views.includes('proposals') ? [{ key: 'proposals', label: t('proposals'), href: '/animals/proposals', count: openProposals, tone: 'agent' as const, testId: 'animals-tab-proposals' }] : []),
          ]}
        />
      ) : null}

      <FilterBar
        search={<SearchField value={filters.text} onChange={(text) => applyFilters({ text })} placeholder={t('search')} />}
        searchActive={filters.text.trim() ? { chip: filters.text.trim(), onClear: () => applyFilters({ text: '' }) } : undefined}
        filters={[
          selectFilter({ key: 'status', label: t('filterStatus'), value: filters.status, options: LIST_STATUSES.map((s) => ({ value: s, label: f(`status.${s}`) })), onChange: (status) => applyFilters({ status }) }),
          selectFilter({ key: 'location', label: t('filterLocation'), value: filters.location, options: LIST_LOCATIONS.map((l) => ({ value: l, label: f(`locations.${l}`) })), onChange: (location) => applyFilters({ location }) }),
          selectFilter({
            key: 'published',
            label: t('filterPublished'),
            value: filters.published,
            options: [
              { value: '1', label: t('publishedYes') },
              { value: '0', label: t('publishedNo') },
            ],
            onChange: (published) => applyFilters({ published }),
          }),
        ]}
        onApply={(values) => applyFilters(values as Partial<Filters>)}
        // „Prüfung offen“ ist eine Sicht, kein Filter: Ihre Gesamtzahl ist die der Sicht.
        count={{ shown: animals.length, total: review ? reviewPending : total, noun: { one: t('nounOne'), other: t('nounOther'), dative: t('nounDative') } }}
        onReset={reset}
      />

      {animals.length === 0 && filtered ? (
        // Befund 4: Der Umschalter „Alle“ behält die Filter — der Ausweg ist Zurücksetzen, die Ansicht bleibt.
        <EmptyState filtered={{ noun: t('noMatchNoun'), onReset: reset }} />
      ) : animals.length === 0 ? (
        <EmptyState title={t('noMatchTitle')} text={t('noMatchText')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table className="text-body">
            <TableHeader>
              <TableRow>
                {canExport ? (
                  <TableHead col="select" className="w-10 pr-0 pl-4">
                    <Checkbox aria-label={t('selection.selectAll')} checked={allSelected} indeterminate={selected.length > 0 && !allSelected} onCheckedChange={() => selection.toggle(animals.map((a) => a.id), !allSelected)} />
                  </TableHead>
                ) : null}
                <SortableHead col="title" field="name" label={t('columns.animal')} />
                <TableHead col="status">{t('columns.status')}</TableHead>
                <TableHead col="meta">{t('columns.flags')}</TableHead>
                <TableHead col="meta">{t('columns.location')}</TableHead>
                <TableHead className="text-right">{t('columns.photos')}</TableHead>
                <SortableHead col="meta" field="updatedAt" label={t('columns.updated')} />
                <TableHead col="actions" className="text-right">{t('columns.published')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {animals.map((a, i) => (
                // Runde 3, 192: Vermittelt ist der Endzustand — gedämpfte Zeile mit Marke am Namen, keine eigene Marke im Status.
                <TableRow key={a.id} data-testid="animal-row" muted={a.status === 'adopted' ? f('status.adopted') : undefined}>
                  {canExport ? (
                    // Das Kästchen wählt aus; die Zeile öffnet weiter den Hund.
                    <TableCell col="select" className="w-10 pr-0 pl-4">
                      <Checkbox aria-label={t('selection.selectOne', { name: a.name })} checked={selection.ids.has(a.id)} onCheckedChange={(on) => selection.toggle([a.id], on === true)} />
                    </TableCell>
                  ) : null}
                  {/* Die Marke „Vermittelt“ steht direkt hinter dem Namen, mit den übrigen Marken als Gruppe: Passt die Gruppe
                      nicht mehr, bricht sie gemeinsam um, nie unter das Foto (Runde 4, 043, 192). */}
                  <TableCell col="title" mutedMark="inline">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {/* Die Vorschau statt des Originals: Bei einigen hundert Hunden lüde die Liste sonst jedes Foto in voller Größe. */}
                      {a.primaryAssetId ? <img src={`/media/${a.primaryAssetId}/preview`} loading="lazy" alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-ink" aria-hidden><PawPrint className="size-4" /></span>}
                      <RowLink href={`/animals/${a.id}${listQs ? `?${listQs}` : ''}`}>{a.name}</RowLink>
                      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
                      <MutedMark />
                      {proposalIds.has(a.id) ? (
                        <StatusBadge tone="agent" icon={Inbox} testId="animal-proposal-badge">{t('proposalBadge')}</StatusBadge>
                      ) : null}
                      {a.reviewRequestedAt ? (
                        <span title={a.reviewNote || undefined} data-testid="animal-review-badge">
                          <StatusBadge tone="warning">{t('reviewBadge')}</StatusBadge>
                        </span>
                      ) : null}
                      </span>
                    </span>
                  </TableCell>
                  {/* „Sucht ein Zuhause“ ist der Normalfall und steht in der Liste ohne Marke (Runde 3, Kleinpunkt 6, 043). */}
                  <TableCell col="status">
                    {isNormalInList('animal', a.status) || a.status === 'adopted' ? null : (
                      <StatusBadge tone={statusTone('animal', a.status)} dot>
                        {f(`status.${a.status}`)}
                      </StatusBadge>
                    )}
                  </TableCell>
                  <TableCell col="meta">
                    {a.isEmergency || a.isSponsorable ? (
                      <span className="flex items-center gap-1.5">
                        {a.isEmergency ? <StatusBadge tone="error">{t('emergency')}</StatusBadge> : null}
                        {a.isSponsorable ? <StatusBadge tone="brand">{t('sponsorable')}</StatusBadge> : null}
                      </span>
                    ) : (
                      <Empty />
                    )}
                  </TableCell>
                  {/* Backlog 72: Ort ist Text („im Shelter · Rumänien, Ploiești“), am Telefon eine eigene Zeile wie bei den Auszügen
                      (Kompromiss b). Kein Layout-Test (Einzelstelle, Laufzeit zählt). */}
                  <TableCell col="meta" wrap className="text-ink-2">{[f(`locations.${a.location}`), a.place].filter(Boolean).join(' · ')}</TableCell>
                  <TableCell className="tabular-nums text-right text-meta text-ink-2">{a.photoCount}</TableCell>
                  <TableCell col="meta" className="text-ink-2">
                    {dates.date(a.updatedAt)}
                    {/* 043: Am Telefon steht statt des Schalters ohne Spaltenkopf ein Text in der Unterzeile; geschaltet
                        wird auf dem Tier. Kein Layout-Test (Einzelstelle, Laufzeit zählt). */}
                    {a.isPublished ? <span className="md:hidden"> · {c('onWebsite')}</span> : null}
                  </TableCell>
                  <TableCell col="actions">
                    <span className="flex justify-end max-md:hidden">
                      <PublishSwitch id={a.id} isPublished={a.isPublished} action={setAnimalPublishedAction} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {/* Unter der Tabelle und klebend; die Live-Region darin steht immer im DOM (Kommentar im Baustein). */}
      {canExport ? (
        <SelectionBar count={selected.length} label={t('selection.count', { count: selected.length })}>
          <ProfileExportButton ids={selected.map((a) => a.id)} size="sm" />
        </SelectionBar>
      ) : null}
    </div>
  );
}
