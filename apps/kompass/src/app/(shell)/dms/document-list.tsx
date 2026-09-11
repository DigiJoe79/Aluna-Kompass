'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useState, useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';
import { SnippetText } from '@/components/snippet-text';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
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
}

export interface DocumentListProps {
  documents: DocumentListItem[];
  types: { key: string; label: string }[];
  folders: string[];
  inboxCount: number;
  hits?: Record<string, { page: number; snippet: string }>;
  fulltextTooShort?: boolean;
}

export function DocumentList({ documents, types, folders, inboxCount, hits, fulltextTooShort }: DocumentListProps) {
  const t = useTranslations('dms');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const isInbox = params.get('inbox') === '1';
  const [query, setQuery] = useState(params.get('text') ?? '');
  const [directionFilter, setDirectionFilter] = useState(params.get('direction') ?? '');
  const [typeFilter, setTypeFilter] = useState(params.get('type') ?? '');
  const [folderFilter, setFolderFilter] = useState(params.get('folder') ?? '');
  const [phaseFilter, setPhaseFilter] = useState(params.get('phase') ?? '');

  const applyFilters = (patch: Partial<{ text: string; direction: string; type: string; folder: string; phase: string; inbox: boolean }>) => {
    const nextInbox = patch.inbox !== undefined ? patch.inbox : isInbox;
    const merged = {
      text: query,
      direction: directionFilter,
      type: typeFilter,
      folder: folderFilter,
      phase: phaseFilter,
      ...patch,
    };
    const next = new URLSearchParams();
    if (merged.text.trim()) next.set('text', merged.text.trim());
    if (merged.direction) next.set('direction', merged.direction);
    if (merged.type) next.set('type', merged.type);
    if (merged.phase) next.set('phase', merged.phase);
    if (nextInbox) {
      next.set('inbox', '1');
    } else if (merged.folder) {
      next.set('folder', merged.folder);
    }
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Link
          href="/dms"
          onClick={(e) => {
            if (!isInbox) return;
            e.preventDefault();
            applyFilters({ inbox: false });
          }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
            !isInbox ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
          )}
        >
          {t('allDocuments')}
        </Link>
        <Link
          href="/dms?inbox=1"
          onClick={(e) => {
            if (isInbox) return;
            e.preventDefault();
            applyFilters({ inbox: true });
          }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
            isInbox ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
          )}
        >
          <span>{t('inbox')}</span>
          <span className="rounded-full bg-badge px-2 py-0.5 text-[11px] font-semibold text-badge-ink">
            {inboxCount}
          </span>
        </Link>
      </div>

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
        {!isInbox ? (
          <Select
            aria-label={t('columns.folder')}
            value={folderFilter}
            onChange={(e) => {
              const val = e.target.value;
              setFolderFilter(val);
              applyFilters({ folder: val });
            }}
            className="w-auto"
          >
            <option value="">{t('allFolders')}</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        ) : null}
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
      </div>

      {fulltextTooShort ? <p className="text-[13px] text-muted-ink">{t('searchTooShort')}</p> : null}

      {documents.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
              <TableRow className="h-9">
                <TableHead className="px-4">{t('columns.number')}</TableHead>
                <TableHead className="px-4">{t('columns.subject')}</TableHead>
                <TableHead className="px-4">{t('columns.type')}</TableHead>
                <TableHead className="px-4">{t('columns.date')}</TableHead>
                <TableHead className="px-4">{t('columns.folder')}</TableHead>
                <TableHead className="px-4">{t('columns.direction')}</TableHead>
                <TableHead className="px-4">{t('columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc, i) => (
                <Fragment key={doc.id}>
                  <TableRow
                    onClick={() => router.push(`/dms/${doc.id}`)}
                    className={cn(
                      'h-[52px] cursor-pointer hover:bg-row-hover',
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
                          className="font-semibold underline underline-offset-2 hover:text-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {doc.subject}
                        </Link>
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
                    <TableCell className="px-4 text-ink-2">{doc.documentDate}</TableCell>
                    <TableCell className="px-4 text-ink-2">{doc.folder ?? t('inbox')}</TableCell>
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
