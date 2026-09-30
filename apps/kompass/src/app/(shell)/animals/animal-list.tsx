'use client';

import type { AnimalListItem } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { SortableHead } from '@/components/sortable-head';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUrlFilters } from '@/lib/use-url-filters';
import { cn } from '@/lib/utils';
import { setAnimalPublishedAction } from './actions';
import { LIST_LOCATIONS, LIST_STATUSES, listQueryString } from './list-params';

type Filters = { text: string; status: string; location: string; published: string };

export function AnimalList({ animals, total, reviewPending }: { animals: AnimalListItem[]; total: number; reviewPending: number }) {
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
            <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
              <TableRow className="h-9">
                <SortableHead field="name" label={t('columns.animal')} />
                <TableHead className="px-4">{t('columns.status')}</TableHead>
                <TableHead className="px-4">{t('columns.flags')}</TableHead>
                <TableHead className="px-4">{t('columns.location')}</TableHead>
                <TableHead className="px-4 text-right">{t('columns.photos')}</TableHead>
                <SortableHead field="updatedAt" label={t('columns.updated')} />
                <TableHead className="px-4 text-right">{t('columns.published')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {animals.map((a, i) => (
                // Kein Zeilen-`onClick` wie bei den Kontakten: Der Schalter rechts darf den Weg ins Profil nicht auslösen.
                <TableRow key={a.id} data-testid="animal-row" className={cn('h-[52px] border-b border-line-2 hover:bg-row-hover', i % 2 === 1 && 'bg-zebra')}>
                  <TableCell className="px-4">
                    <span className="flex items-center gap-3">
                      {/* Die Vorschau statt des Originals: Bei einigen hundert Hunden lüde die Liste sonst jedes Foto in voller Größe. */}
                      {a.primaryAssetId ? <img src={`/media/${a.primaryAssetId}/preview`} loading="lazy" alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <span className="size-9 shrink-0 rounded-full bg-surface-2" aria-hidden />}
                      <Link href={`/animals/${a.id}${listQs ? `?${listQs}` : ''}`} className="font-semibold text-link underline">{a.name}</Link>
                      {a.reviewRequestedAt ? (
                        <span title={a.reviewNote || undefined} data-testid="animal-review-badge">
                          <StatusBadge tone="warning">{t('reviewBadge')}</StatusBadge>
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="px-4">
                    <StatusBadge tone={a.status === 'adopted' ? 'success' : a.status === 'reserved' ? 'warning' : 'info'} dot>
                      {f(`status.${a.status}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="px-4">
                    <span className="flex items-center gap-1.5">
                      {a.isEmergency ? <StatusBadge tone="error">{t('emergency')}</StatusBadge> : null}
                      {a.isSponsorable ? <StatusBadge tone="accent">{t('sponsorable')}</StatusBadge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 text-ink-2">{[f(`locations.${a.location}`), a.place].filter(Boolean).join(' · ')}</TableCell>
                  <TableCell className="px-4 text-right font-mono text-[13px] text-ink-2">{a.photoCount}</TableCell>
                  <TableCell className="px-4 text-ink-2">{dates.date(a.updatedAt)}</TableCell>
                  <TableCell className="px-4">
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
    </div>
  );
}
