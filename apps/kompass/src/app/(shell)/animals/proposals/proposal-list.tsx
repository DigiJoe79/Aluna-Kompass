'use client';

import type { ProposalList as ProposalListData, ProposalListItem } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, frameFilter, selectFilter } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { StatusBadge } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewTabs } from '@/components/view-tabs';
import { useHeldKey } from '@/lib/held-decision';
import { useUrlFilters } from '@/lib/use-url-filters';
import type { AnimalView } from '../view-tabs';
import { fieldLabelKey } from './field-format';
import { KindBadge } from './kind-badge';
import { PROPOSAL_KIND_FILTER, PROPOSAL_STATE_FILTER, proposalQueryString } from './list-params';
import { mediaPreviewUrl, proposalImageUrl } from '../crop-frame';

type Filters = { text: string; kind: string; source: string; state: string };

/** Rundes Bild der Zeile: das Titelbild des Tiers heute, sonst das des Vorschlags (neuer Hund), sonst ein leerer Kreis. */
export function ProposalThumb({ item }: { item: Pick<ProposalListItem, 'primaryAssetId' | 'primaryImageId'> }) {
  const src = item.primaryAssetId ? mediaPreviewUrl(item.primaryAssetId) : item.primaryImageId ? proposalImageUrl(item.primaryImageId) : null;
  return src ? <img src={src} loading="lazy" alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <span className="size-9 shrink-0 rounded-full bg-surface-2" aria-hidden />;
}

const REASON_MAX = 90;
const shorten = (text: string) => (text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text);

/**
 * Die Inbox als Reiter der Tierliste (Board Vorschläge 1a): eigene Filter (Art, Quelle, Zustand als Rahmen), eigene
 * Spalten. Die Zeile öffnet die Prüfseite, nicht den Hund; die Auswahl reist mit (QueueNav).
 */
export function ProposalList({
  list,
  totalAnimals,
  reviewPending,
  views,
  query,
}: {
  list: ProposalListData;
  totalAnimals: number;
  reviewPending: number;
  views: readonly AnimalView[];
  query: string;
}) {
  const t = useTranslations('animals.proposals');
  const l = useTranslations('animals.list');
  const root = useTranslations();
  const dates = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const params = new URLSearchParams(query);
  const [filters, setFilters] = useUrlFilters<Filters>({
    text: params.get('text') ?? '',
    kind: params.get('kind') ?? '',
    source: params.get('source') ?? '',
    state: params.get('state') ?? 'open',
  });
  const apply = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    const qs = proposalQueryString({ ...merged, text: merged.text.trim() });
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };
  const open = filters.state === 'open';
  const filtered = Boolean(filters.text.trim() || filters.kind || filters.source);
  const reset = () => apply({ text: '', kind: '', source: '' });
  const rowQs = query ? `?${query}` : '';
  // Ein zurückgehaltener Hinweis (5 s, MUSTER § C Ausnahme) ist entschieden: nicht als offen zeigen und nicht mitzählen (M4).
  const held = useHeldKey();
  const hidden = open && held !== null && list.proposals.some((p) => p.id === held) ? 1 : 0;
  const proposals = hidden ? list.proposals.filter((p) => p.id !== held) : list.proposals;
  const openCount = list.open.count - hidden;

  const content = (p: ProposalListItem) => {
    if (p.cleared) return '—';
    if (p.kind === 'notice') return p.noticeKind === 'delisted' ? t('delistedLine', { source: p.sourceName }) : shorten(p.reason ?? '');
    if (p.kind === 'sameAs') return t('sameAsLine', { name: p.proposedName || p.name });
    // Neuer Hund: Alle Felder sind vorgeschlagen; die Zeile nennt nur die Fotos (Board 1a), die Marken das Übrige.
    if (p.kind === 'create') return p.photoCount > 0 ? t('photos', { count: p.photoCount }) : '—';
    const names = p.fields.map((f) => root(fieldLabelKey(f)));
    if (p.photoCount > 0) names.push(t('photos', { count: p.photoCount }));
    return names.join(', ');
  };
  const stateWord = (p: ProposalListItem) => (p.kind === 'notice' && p.state === 'accepted' ? t('states.acknowledged') : t(`states.${p.state}`));

  return (
    <div className="flex flex-col gap-3">
      {/* Ausnahme zu MUSTER § L (Spec § 6, Board 1d): Die Reiter führen zurück in die Tierliste ohne deren Filter. */}
      <ViewTabs
        label={l('views')}
        current="proposals"
        tabs={[
          { key: 'all', label: l('all'), href: '/animals', count: totalAnimals },
          ...(views.includes('review') ? [{ key: 'review', label: l('reviewPending'), href: '/animals?review=1', count: reviewPending }] : []),
          { key: 'proposals', label: l('proposals'), href: '/animals/proposals', count: openCount, tone: 'agent' as const, testId: 'animals-tab-proposals' },
        ]}
      />
      <FilterBar
        search={<SearchField value={filters.text} onChange={(text) => apply({ text })} placeholder={t('search')} />}
        searchActive={filters.text.trim() ? { chip: filters.text.trim(), onClear: () => apply({ text: '' }) } : undefined}
        filters={[
          selectFilter({ key: 'kind', label: t('filterKind'), value: filters.kind, options: PROPOSAL_KIND_FILTER.map((k) => ({ value: k, label: t(`kinds.${k}`) })), onChange: (kind) => apply({ kind }) }),
          selectFilter({ key: 'source', label: t('filterSource'), value: filters.source, options: list.sources.map((s) => ({ value: s.userId, label: s.name })), onChange: (source) => apply({ source }) }),
          frameFilter({
            key: 'state',
            label: t('stateFilter.label'),
            value: filters.state,
            options: PROPOSAL_STATE_FILTER.map((s) => ({ value: s, label: `${t('stateFilter.label')}: ${t(`stateFilter.${s}`)}` })),
            onChange: (state) => apply({ state }),
          }),
        ]}
        onApply={(values) => apply(values as Partial<Filters>)}
        count={{ shown: proposals.length, total: open ? openCount : proposals.length, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
        onReset={reset}
      />
      {proposals.length === 0 && filtered ? (
        <EmptyState filtered={{ noun: t('noMatchNoun'), onReset: reset }} />
      ) : proposals.length === 0 ? (
        <EmptyState title={t('emptyTitle')} text={t('emptyText')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table className="text-body">
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.kind')}</TableHead>
                <TableHead>{t('columns.animal')}</TableHead>
                <TableHead>{t('columns.content')}</TableHead>
                <TableHead>{t('columns.source')}</TableHead>
                {open ? (
                  <TableHead>{t('columns.received')}</TableHead>
                ) : (
                  <>
                    <TableHead>{t('columns.state')}</TableHead>
                    <TableHead>{t('columns.decided')}</TableHead>
                    <TableHead>{t('columns.reason')}</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals.map((p) => (
                <TableRow key={p.id} data-testid="proposal-row">
                  <TableCell className="w-0 whitespace-nowrap">
                    <KindBadge kind={p.kind} />
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ProposalThumb item={p} />
                      <RowLink href={`/animals/proposals/${p.id}${rowQs}`}>{p.name || t('unnamed')}</RowLink>
                      {p.conflictCount > 0 ? <StatusBadge tone="warning">{t('conflicts', { count: p.conflictCount })}</StatusBadge> : null}
                      {/* Neutral: Das Violett der Herkunft trägt schon die Art-Marke daneben (Befund 10). */}
                      {p.hintCount > 0 ? <StatusBadge tone="neutral">{t('hints', { count: p.hintCount })}</StatusBadge> : null}
                      {p.missing.map((m) => (
                        <StatusBadge key={m} tone="warning">{t(`missing.${m}`)}</StatusBadge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-ink-2">{content(p)}</TableCell>
                  <TableCell className="text-ink-2">{p.sourceName}</TableCell>
                  {open ? (
                    <TableCell className="whitespace-nowrap text-ink-2">{dates.dateTime(p.createdAt)}</TableCell>
                  ) : (
                    <>
                      <TableCell>
                        <StatusBadge tone={p.state === 'accepted' || p.state === 'acceptedWithChanges' ? 'success' : 'neutral'}>{stateWord(p)}</StatusBadge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-2">
                        {p.decisionReason === 'animalDeleted' ? t('animalDeleted') : p.decidedAt ? [p.decidedByName, dates.dateTime(p.decidedAt)].filter(Boolean).join(' · ') : '—'}
                      </TableCell>
                      <TableCell className="text-ink-2">{p.decisionNote ?? ''}</TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
