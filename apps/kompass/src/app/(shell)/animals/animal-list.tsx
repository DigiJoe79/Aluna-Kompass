'use client';

import type { AnimalListItem } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { SelectionBar } from '@/components/selection-bar';
import { SortableHead } from '@/components/sortable-head';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listKeyOf, useListSelection } from '@/lib/use-list-selection';
import { useUrlFilters } from '@/lib/use-url-filters';
import { cn } from '@/lib/utils';
import { setAnimalPublishedAction } from './actions';
import { LIST_LOCATIONS, LIST_STATUSES, listQueryString } from './list-params';
import { ProfileExportButton } from './profile-export-button';

type Filters = { text: string; status: string; location: string; published: string };

export function AnimalList({ animals, total, reviewPending, canExport }: { animals: AnimalListItem[]; total: number; reviewPending: number; canExport: boolean }) {
  const t = useTranslations('animals.list');
  const f = useTranslations('animals.form');
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
  const viewClass = (active: boolean) => cn('rounded-sm px-3 py-1.5 text-[13px] font-semibold', active ? 'bg-brand-soft text-brand-ink' : 'text-muted-ink hover:bg-surface-2');

  return (
    <div className="flex flex-col gap-3">
      <nav className="flex flex-wrap gap-1" aria-label={t('views')}>
        <Link href={viewHref({ review: undefined })} aria-current={review ? undefined : 'page'} className={viewClass(!review)}>
          {t('all', { count: total })}
        </Link>
        <Link href={viewHref({ review: '1', sort: undefined, dir: undefined })} aria-current={review ? 'page' : undefined} className={viewClass(review)}>
          {t('reviewPending', { count: reviewPending })}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label={t('search')} placeholder={t('search')} value={filters.text} onChange={(e) => applyFilters({ text: e.target.value })} className="w-[260px]" />
        <Select aria-label={t('filterStatus')} value={filters.status} onChange={(e) => applyFilters({ status: e.target.value })} className="w-auto">
          <option value="">{t('allStatuses')}</option>
          {LIST_STATUSES.map((s) => <option key={s} value={s}>{f(`status.${s}`)}</option>)}
        </Select>
        <Select aria-label={t('filterLocation')} value={filters.location} onChange={(e) => applyFilters({ location: e.target.value })} className="w-auto">
          <option value="">{t('allLocations')}</option>
          {LIST_LOCATIONS.map((l) => <option key={l} value={l}>{f(`locations.${l}`)}</option>)}
        </Select>
        <Select aria-label={t('filterPublished')} value={filters.published} onChange={(e) => applyFilters({ published: e.target.value })} className="w-auto">
          <option value="">{t('publishedAny')}</option>
          <option value="1">{t('publishedYes')}</option>
          <option value="0">{t('publishedNo')}</option>
        </Select>
        <span className="ml-auto text-[13px] text-muted-ink">{t('countLine', { shown: animals.length, total })}</span>
      </div>

      {animals.length === 0 ? (
        <EmptyState title={t('noMatchTitle')} text={t('noMatchText')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table className="text-[14px]">
            <TableHeader>
              <TableRow>
                {canExport ? (
                  <TableHead className="w-10 pr-0 pl-4">
                    <Checkbox aria-label={t('selection.selectAll')} checked={allSelected} indeterminate={selected.length > 0 && !allSelected} onCheckedChange={() => selection.toggle(animals.map((a) => a.id), !allSelected)} />
                  </TableHead>
                ) : null}
                <SortableHead field="name" label={t('columns.animal')} />
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.flags')}</TableHead>
                <TableHead>{t('columns.location')}</TableHead>
                <TableHead className="text-right">{t('columns.photos')}</TableHead>
                <SortableHead field="updatedAt" label={t('columns.updated')} />
                <TableHead className="text-right">{t('columns.published')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {animals.map((a, i) => (
                <TableRow key={a.id} data-testid="animal-row">
                  {canExport ? (
                    // Das Kästchen wählt aus; die Zeile öffnet weiter den Hund.
                    <TableCell className="w-10 pr-0 pl-4">
                      <Checkbox aria-label={t('selection.selectOne', { name: a.name })} checked={selection.ids.has(a.id)} onCheckedChange={(on) => selection.toggle([a.id], on === true)} />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <span className="flex items-center gap-3">
                      {/* Die Vorschau statt des Originals: Bei einigen hundert Hunden lüde die Liste sonst jedes Foto in voller Größe. */}
                      {a.primaryAssetId ? <img src={`/media/${a.primaryAssetId}/preview`} loading="lazy" alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <span className="size-9 shrink-0 rounded-full bg-surface-2" aria-hidden />}
                      <RowLink href={`/animals/${a.id}${listQs ? `?${listQs}` : ''}`}>{a.name}</RowLink>
                      {a.reviewRequestedAt ? (
                        <span title={a.reviewNote || undefined} data-testid="animal-review-badge">
                          <StatusBadge tone="warning">{t('reviewBadge')}</StatusBadge>
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={a.status === 'adopted' ? 'success' : a.status === 'reserved' ? 'warning' : 'info'} dot>
                      {f(`status.${a.status}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      {a.isEmergency ? <StatusBadge tone="error">{t('emergency')}</StatusBadge> : null}
                      {a.isSponsorable ? <StatusBadge tone="accent">{t('sponsorable')}</StatusBadge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-ink-2">{[f(`locations.${a.location}`), a.place].filter(Boolean).join(' · ')}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] text-ink-2">{a.photoCount}</TableCell>
                  <TableCell className="text-ink-2">{dates.date(a.updatedAt)}</TableCell>
                  <TableCell>
                    <span className="flex justify-end">
                      <PublishSwitch id={a.id} isPublished={a.isPublished} action={setAnimalPublishedAction} switchAfterText />
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
