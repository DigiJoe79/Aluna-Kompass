'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useState, useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';
import { SnippetText } from '@/components/snippet-text';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { SortableHead } from '@/components/sortable-head';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFinePointer } from '@/lib/use-fine-pointer';
import { useUrlFilters } from '@/lib/use-url-filters';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { setDragPreview } from '@/components/folder-tree/drag-preview';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DOCUMENTS_MIME, beginDrag } from '@/lib/drag-types';
import { isWithin, namesBelow } from '@/lib/folder-tree-model';
import { useDocumentMoves } from './document-moves';

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
  /**
   * Der Ordner, dessen Teilbaum die Liste zeigt — vom Server, also passend zu
   * `documents`, auch während die Adresse schon zum nächsten wechselt.
   */
  currentFolder: string | null;
  /** Wie viele Dokumente passen — die Liste holt höchstens eine Seite davon. */
  total: number;
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

export function DocumentList({ documents, currentFolder, total, types, folders, inboxCount, hits, fulltextTooShort, today, canMove }: DocumentListProps) {
  const t = useTranslations('dms');
  const tTree = useTranslations('folderTree');
  const fmt = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const isInbox = params.get('inbox') === '1';
  const openFolder = isInbox ? null : currentFolder;
  const moves = useDocumentMoves();
  const selectable = canMove && moves !== null;
  // Am Telefon wird nicht gezogen; dort verschiebt „Verschieben nach…“ (Spec Ordnerbaum § 5.6).
  const fine = useFinePointer();
  // Die Felder folgen der Adresse, wenn sie von außen wechselt (Seitenleiste, Zurück-Knopf, Kachel der Startseite).
  const [filters, setFilters] = useUrlFilters({
    text: params.get('text') ?? '',
    direction: params.get('direction') ?? '',
    type: params.get('type') ?? '',
    phase: params.get('phase') ?? '',
    unsent: params.get('unsent') === '1' ? 'unsent' : '',
    followUp: params.get('followUp') === 'open' ? 'open' : '',
  });
  const { text: query, direction: directionFilter, type: typeFilter, phase: phaseFilter, unsent: dispatchFilter, followUp: followUpFilter } = filters;

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
    setFilters({ text: merged.text, direction: merged.direction, type: merged.type, phase: merged.phase, unsent: merged.unsent, followUp: merged.followUp });
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

  /**
   * Was die Liste zeigt: der Stand des Servers, darüber laufende Züge
   * vorweggenommen. Was dabei den geöffneten Ort verlässt, fällt heraus; in
   * „Alle Dokumente“ wechselt nur die Spalte „Ordner“.
   */
  const placed = moves?.placed ?? {};
  const shown = documents.flatMap((doc) => {
    if (!(doc.id in placed)) return [doc];
    const folder = placed[doc.id] ?? null;
    if (isInbox && folder !== null) return [];
    if (openFolder !== null && (folder === null || !isWithin(folder, openFolder))) return [];
    return [{ ...doc, folder }];
  });

  // Der Baum schlägt beim Ablegen Ort und Betreff nach (er bekommt nur IDs).
  useEffect(() => {
    moves?.remember(documents.map(({ id, folder, subject, direction }) => ({ id, folder, subject, direction })));
  }, [documents, moves]);

  /**
   * Die Auswahl gehört zu dieser Liste: Ein anderer Ort oder andere Filter
   * sind eine neue Liste und fangen leer an (Sortieren nicht — dieselben
   * Zeilen). Kommt die Liste nach einem Zug neu vom Server, fällt heraus, was
   * nicht mehr darin steht; der Rest bleibt angekreuzt.
   */
  const listKey = [...params.entries()].filter(([key]) => key !== 'sort' && key !== 'dir').map(([key, value]) => `${key}=${value}`).sort().join('&');
  const [selection, setSelection] = useState({ listKey, documents, ids: new Set<string>() });
  if (selection.listKey !== listKey || selection.documents !== documents) {
    const present = new Set(documents.map((doc) => doc.id));
    const ids = selection.listKey !== listKey ? new Set<string>() : new Set([...selection.ids].filter((id) => present.has(id)));
    setSelection({ listKey, documents, ids });
  }
  const selected = shown.filter((doc) => selection.ids.has(doc.id));
  const allSelected = shown.length > 0 && selected.length === shown.length;
  const toggle = (ids: string[], on: boolean) =>
    setSelection((prev) => {
      const next = new Set(prev.ids);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return { ...prev, ids: next };
    });

  /** Die Zeilen, die gerade gezogen werden — gedämpft (Artboard 2a). */
  const [dragging, setDragging] = useState<ReadonlySet<string>>(new Set());
  // Am Fenster, nicht an der Zeile: Verschwindet sie während des Zugs, kommt ihr `dragend` nie an.
  useEffect(() => {
    if (dragging.size === 0) return;
    const end = () => setDragging(new Set());
    window.addEventListener('dragend', end, true);
    window.addEventListener('drop', end, true);
    return () => {
      window.removeEventListener('dragend', end, true);
      window.removeEventListener('drop', end, true);
    };
  }, [dragging]);

  /** Wer eine angekreuzte Zeile zieht, zieht die ganze Auswahl; eine nicht angekreuzte nur sich (Artboard 2b). */
  const startDrag = (transfer: DataTransfer, doc: DocumentListItem) => {
    const group = selection.ids.has(doc.id) ? selected : [doc];
    const ids = group.map((d) => d.id);
    const label = group.length === 1 ? doc.subject : t('selection.dragTitle', { count: group.length });
    transfer.setData(DOCUMENTS_MIME, JSON.stringify(ids));
    transfer.effectAllowed = 'move';
    // Herkunft für den Baum: „Liegt schon hier“ zeigt er schon beim Überfahren.
    beginDrag({ kind: 'documents', ids, sources: group.map((d) => d.folder), label });
    setDragPreview(transfer, { kind: 'document', title: label, stacked: group.length > 1 });
    setDragging(new Set(ids));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => {
            applyFilters({ text: e.target.value });
          }}
          className="w-[260px]"
        />
        <Select
          aria-label={t('columns.direction')}
          value={directionFilter}
          onChange={(e) => {
            const val = e.target.value;
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
            applyFilters({ followUp: val });
          }}
          className="w-auto"
        >
          <option value="">{t('filters.followUpAll')}</option>
          <option value="open">{t('filters.followUpOpen')}</option>
        </Select>
      </div>

      {fulltextTooShort ? <p className="text-[13px] text-muted-ink">{t('searchTooShort')}</p> : null}

      {/* Immer da, nur der Text wechselt: Eine Live-Region sagt nur an, was in ihr geschieht, nachdem sie im DOM steht. */}
      {selectable ? (
        <span data-testid="selection-live" role="status" className="sr-only">
          {selected.length > 0 ? t('selection.count', { count: selected.length }) : ''}
        </span>
      ) : null}
      {selectable && selected.length > 0 ? (
        <div data-testid="selection-bar" className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-4 py-1.5 text-[13px] text-ink">
          <span aria-hidden className="font-semibold">
            {t('selection.count', { count: selected.length })}
          </span>
          <span aria-hidden className="text-muted-ink">
            ·
          </span>
          <Button variant="outline" size="sm" onClick={() => moves?.requestMove(selected)}>
            {tTree('moveTo')}
          </Button>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          {/* 12 px Zellabstand wie im Artboard: Damit passen alle Spalten ohne Querscrollen, auch auf dem Tablet. */}
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <TableHeader className="bg-table-head text-left text-[11px] font-bold uppercase tracking-[.06em] text-muted-ink">
              <TableRow className="h-9">
                {selectable ? (
                  <TableHead className="w-10 pr-0 pl-4">
                    <Checkbox
                      aria-label={t('selection.selectAll')}
                      checked={allSelected}
                      indeterminate={selected.length > 0 && !allSelected}
                      onCheckedChange={() => toggle(shown.map((doc) => doc.id), !allSelected)}
                    />
                  </TableHead>
                ) : null}
                <SortableHead field="number" label={t('columns.number')} />
                <SortableHead field="subject" label={t('columns.subject')} />
                {/* Auf dem Tablet fehlt der Platz; die Spalte „Ordner“ trägt dort mehr (Spec § 9). */}
                <SortableHead field="typeKey" label={t('columns.type')} className="max-[1100px]:hidden" />
                <SortableHead field="documentDate" label={t('columns.date')} />
                <SortableHead field="folder" label={t('columns.folder')} />
                <TableHead className="px-4">{t('columns.direction')}</TableHead>
                <TableHead className="px-4">{t('columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((doc, i) => (
                <Fragment key={doc.id}>
                  <TableRow
                    data-document-id={doc.id}
                    draggable={canMove && fine}
                    onDragStart={(e) => startDrag(e.dataTransfer, doc)}
                    onDragEnd={() => setDragging(new Set())}
                    onClick={() => router.push(`/dms/${doc.id}`)}
                    className={cn(
                      'h-row cursor-pointer hover:bg-row-hover',
                      hits?.[doc.id] ? 'border-b-0' : 'border-b border-line-2',
                      i % 2 === 1 && 'bg-zebra',
                      dragging.has(doc.id) && 'opacity-50',
                    )}
                  >
                    {selectable ? (
                      // Das Kästchen wählt aus; die Zeile öffnet weiter das Dokument.
                      <TableCell className="w-10 pr-0 pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={t('selection.selectOne', { subject: doc.subject })}
                          checked={selection.ids.has(doc.id)}
                          onCheckedChange={(on) => toggle([doc.id], on === true)}
                        />
                      </TableCell>
                    ) : null}
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
                    {/* Betreff, Art und Ordner brechen um, damit „Ordner“ auch auf dem Tablet ohne Querscrollen sichtbar bleibt (Spec § 9). */}
                    <TableCell className="min-w-[160px] px-4 whitespace-normal hyphens-auto wrap-anywhere max-[1100px]:min-w-[140px]">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                            {t('followUpBadge', { date: fmt.date(doc.openFollowUp.dueAt) })}
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
                    <TableCell className="min-w-[110px] px-4 whitespace-normal hyphens-auto wrap-anywhere text-ink-2 max-[1100px]:hidden">{doc.typeLabel}</TableCell>
                    <TableCell className="px-4 font-mono text-[13px] text-ink-2">{fmt.date(doc.documentDate)}</TableCell>
                    {/* Der Ort unter dem geöffneten Ordner, als Namen mit „›“; leer heißt „direkt hier“. */}
                    <TableCell data-folder-cell className="min-w-[110px] px-4 whitespace-normal text-ink-2">
                      {doc.folder === null ? (doc.direction === 'incoming' ? t('inbox') : t('noFolder')) : namesBelow(doc.folder, openFolder).join(' › ')}
                    </TableCell>
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
                      <TableCell colSpan={selectable ? 8 : 7} className="px-4 pt-0 pb-3 text-[13px] text-muted-ink">
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

      {documents.length < total ? (
        <p data-testid="list-truncated" className="text-[13px] text-muted-ink">
          {t('list.truncated', { shown: documents.length, total })}
        </p>
      ) : null}
    </div>
  );
}
