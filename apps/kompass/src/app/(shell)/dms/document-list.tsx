'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useState, useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';
import { SnippetText } from '@/components/snippet-text';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { SortableHead } from '@/components/sortable-head';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';

export interface DocumentListItem {
  id: string;
  number: string | null;
  subject: string;
  typeKey: string;
  typeLabel: string;
  documentDate: string;
  folder: string | null;
  direction: 'incoming' | 'outgoing';
  phase: 'draft' | 'issued';
  status: 'draft' | 'issued' | 'voided';
  textStatus?: 'pending' | 'running' | 'done' | 'failed' | 'unavailable' | null;
  sentAt: string | null;
  /** Die nächste offene Wiedervorlage, wenn es eine gibt. */
  openFollowUp: { dueAt: string } | null;
}

export interface DocumentListProps {
  documents: DocumentListItem[];
  types: { key: string; label: string }[];
  folders: string[];
  inboxCount: number;
  hits?: Record<string, { page: number; snippet: string }>;
  fulltextTooShort?: boolean;
  /** Heute, aus der Uhr des Servers — nicht aus der des Browsers. */
  today: string;
  /** Darf der Betrachter Dokumente verschieben (`dms.create`)? */
  canMove: boolean;
}

export function DocumentList({ documents, types, folders, inboxCount, hits, fulltextTooShort, today, canMove }: DocumentListProps) {
  const t = useTranslations('dms');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const isInbox = params.get('inbox') === '1';
  const [query, setQuery] = useState(params.get('text') ?? '');
  const [directionFilter, setDirectionFilter] = useState(params.get('direction') ?? '');
  const [typeFilter, setTypeFilter] = useState(params.get('type') ?? '');
  const [phaseFilter, setPhaseFilter] = useState(params.get('phase') ?? '');
  const [dispatchFilter, setDispatchFilter] = useState(params.get('unsent') === '1' ? 'unsent' : '');
  const [followUpFilter, setFollowUpFilter] = useState(params.get('followUp') === 'open' ? 'open' : '');

  const applyFilters = (
    patch: Partial<{ text: string; direction: string; type: string; folder: string; phase: string; inbox: boolean; unsent: string; followUp: string }>,
  ) => {
    const nextInbox = patch.inbox !== undefined ? patch.inbox : isInbox;
    const merged = {
      text: query,
      direction: directionFilter,
      type: typeFilter,
      folder: params.get('folder') ?? '',
      phase: phaseFilter,
      unsent: dispatchFilter,
      followUp: followUpFilter,
      ...patch,
    };
    const next = new URLSearchParams();
    if (merged.text.trim()) next.set('text', merged.text.trim());
    if (merged.direction) next.set('direction', merged.direction);
    if (merged.type) next.set('type', merged.type);
    if (merged.phase) next.set('phase', merged.phase);
    if (merged.unsent === 'unsent') next.set('unsent', '1');
    if (merged.followUp === 'open') next.set('followUp', 'open');
    if (nextInbox) {
      next.set('inbox', '1');
    } else if (merged.folder) {
      next.set('folder', merged.folder);
    }
    // Sortierung ist kein Filter, sie überlebt jeden Filterwechsel.
    for (const key of ['sort', 'dir']) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            applyFilters({ text: e.target.value });
          }}
          className="w-[260px]"
        />
        <Select
          aria-label={t('columns.direction')}
          value={directionFilter}
          onChange={(e) => {
            const val = e.target.value;
            setDirectionFilter(val);
            applyFilters({ direction: val });
          }}
          className="w-auto"
        >
          <option value="">{t('allDirections')}</option>
          <option value="incoming">{t('directions.incoming')}</option>
          <option value="outgoing">{t('directions.outgoing')}</option>
        </Select>
        <Select
          aria-label={t('columns.type')}
          value={typeFilter}
          onChange={(e) => {
            const val = e.target.value;
            setTypeFilter(val);
            applyFilters({ type: val });
          }}
          className="w-auto"
        >
          <option value="">{t('allTypes')}</option>
          {types.map((type) => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('columns.status')}
          value={phaseFilter}
          onChange={(e) => {
            const val = e.target.value;
            setPhaseFilter(val);
            applyFilters({ phase: val });
          }}
          className="w-auto"
        >
          <option value="">{t('allPhases')}</option>
          <option value="draft">{t('phases.draft')}</option>
          <option value="issued">{t('phases.issued')}</option>
        </Select>
        <Select
          aria-label={t('filters.dispatch')}
          value={dispatchFilter}
          onChange={(e) => {
            const val = e.target.value;
            setDispatchFilter(val);
            applyFilters({ unsent: val });
          }}
          className="w-auto"
        >
          <option value="">{t('filters.dispatchAll')}</option>
          <option value="unsent">{t('filters.unsent')}</option>
        </Select>
        <Select
          aria-label={t('filters.followUp')}
          value={followUpFilter}
          onChange={(e) => {
            const val = e.target.value;
            setFollowUpFilter(val);
            applyFilters({ followUp: val });
          }}
          className="w-auto"
        >
          <option value="">{t('filters.followUpAll')}</option>
          <option value="open">{t('filters.followUpOpen')}</option>
        </Select>
      </div>

      {fulltextTooShort ? <p className="text-[13px] text-muted-ink">{t('searchTooShort')}</p> : null}

      {documents.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader className="bg-table-head text-left text-[11px] font-bold uppercase tracking-[.06em] text-muted-ink">
              <TableRow className="h-9">
                <SortableHead field="number" label={t('columns.number')} />
                <SortableHead field="subject" label={t('columns.subject')} />
                <SortableHead field="typeKey" label={t('columns.type')} />
                <SortableHead field="documentDate" label={t('columns.date')} />
                <SortableHead field="folder" label={t('columns.folder')} />
                <TableHead className="px-4">{t('columns.direction')}</TableHead>
                <TableHead className="px-4">{t('columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc, i) => (
                <Fragment key={doc.id}>
                  <TableRow
                    data-document-id={doc.id}
                    draggable={canMove}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-kompass-document', doc.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => router.push(`/dms/${doc.id}`)}
                    className={cn(
                      'h-[var(--row-h)] cursor-pointer hover:bg-row-hover',
                      hits?.[doc.id] ? 'border-b-0' : 'border-b border-line-2',
                      i % 2 === 1 && 'bg-zebra',
                    )}
                  >
                    <TableCell className="px-4 font-mono text-[13px] text-ink">
                      {doc.number ? (
                        <Link
                          href={`/dms/${doc.id}`}
                          className="font-semibold underline underline-offset-2 hover:text-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {doc.number}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dms/${doc.id}`}
                          className="font-semibold text-ink underline-offset-2 hover:text-link hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {doc.subject}
                        </Link>
                        {/* Auch hier, nicht nur am rechten Rand: Die
                            Statusspalte steht zu weit weg, um beim Überfliegen
                            zu wirken. */}
                        {doc.phase === 'draft' && doc.status !== 'voided' ? (
                          <StatusBadge tone="warning">{t('phases.draft')}</StatusBadge>
                        ) : null}
                        {doc.direction === 'outgoing' && doc.phase === 'issued' && doc.status !== 'voided' && !doc.sentAt ? (
                          <StatusBadge tone="neutral">{t('dispatch.unsentBadge')}</StatusBadge>
                        ) : null}
                        {doc.openFollowUp ? (
                          <StatusBadge tone={doc.openFollowUp.dueAt < today ? 'warning' : 'info'}>
                            {t('followUpBadge', { date: doc.openFollowUp.dueAt })}
                          </StatusBadge>
                        ) : null}
                        {doc.textStatus && doc.textStatus !== 'done' ? (
                          <span
                            title={t('textPending')}
                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                            aria-label={t('textPending')}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 text-ink-2">{doc.typeLabel}</TableCell>
                    <TableCell className="px-4 font-mono text-[13px] text-ink-2">{doc.documentDate}</TableCell>
                    <TableCell className="px-4 text-ink-2">{doc.folder ?? (doc.direction === 'incoming' ? t('inbox') : t('noFolder'))}</TableCell>
                    <TableCell className="px-4 text-ink-2">{t(`directions.${doc.direction}`)}</TableCell>
                    <TableCell className="px-4">
                      {doc.status === 'voided' ? (
                        <StatusBadge tone="error">{t('statuses.voided')}</StatusBadge>
                      ) : doc.phase === 'draft' ? (
                        <StatusBadge tone="warning">{t('phases.draft')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">{t('phases.issued')}</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                  {hits?.[doc.id] ? (
                    <TableRow
                      onClick={() => router.push(`/dms/${doc.id}`)}
                      className={cn(
                        'cursor-pointer border-b border-line-2 hover:bg-row-hover',
                        i % 2 === 1 && 'bg-zebra',
                      )}
                    >
                      <TableCell colSpan={7} className="px-4 pt-0 pb-3 text-[13px] text-muted-ink">
                        <SnippetText value={hits[doc.id]!.snippet} />{' '}
                        {/* `#page=` versteht jeder Browser-PDF-Betrachter; wir brauchen dafuer keinen
                            eigenen Betrachter und keine Bibliothek. */}
                        <a
                          href={`/dms/${doc.id}/preview#page=${hits[doc.id]!.page}`}
                          className="font-medium underline underline-offset-2 hover:text-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t('hitOnPage', { page: hits[doc.id]!.page })}
                        </a>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
