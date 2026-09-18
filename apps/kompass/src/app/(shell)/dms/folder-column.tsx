'use client';

import { Folder, Inbox, Files } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Die Ordner der Akte als eigene Spalte. Sie ist nicht nur ein Filter, sondern
 * das Ziel: Wer eine Datei aus dem Dateimanager zieht, lässt sie hier fallen.
 * Deshalb bleibt sie beim Ziehen hell, während der Rest abdunkelt.
 */
export function FolderColumn({
  folders,
  counts,
  inboxCount,
  total,
  dragging,
  over,
  onOver,
  onDrop,
  onDropDocument,
}: {
  folders: string[];
  counts: Record<string, number>;
  inboxCount: number;
  total: number;
  /** Eine Datei schwebt über dem Fenster: jede Zeile zeigt sich als Ziel. */
  dragging?: boolean;
  over?: string | null;
  onOver?: (folder: string | null) => void;
  onDrop?: (folder: string | null, files: FileList) => void;
  /** Eine Zeile der Liste, die auf einen Ordner gezogen wurde. */
  onDropDocument?: (folder: string | null, documentId: string) => void;
}) {
  const t = useTranslations('dms');
  const params = useSearchParams();
  const current = params.get('inbox') === '1' ? 'inbox' : (params.get('folder') ?? '');

  const rows = [
    { key: '', href: '/dms', icon: Files, label: t('allDocuments'), count: total, folder: null },
    { key: 'inbox', href: '/dms?inbox=1', icon: Inbox, label: t('inbox'), count: inboxCount, folder: '' },
    ...folders.map((path) => ({
      key: path,
      href: `/dms?folder=${encodeURIComponent(path)}`,
      icon: Folder,
      label: path,
      count: counts[path] ?? 0,
      folder: path,
    })),
  ];

  return (
    <nav
      aria-label={t('folders')}
      className="relative z-3 w-[250px] shrink-0 border-r border-line bg-surface px-2.5 py-3.5"
    >
      <p className="px-2.5 pb-2 text-[11px] font-bold tracking-[0.08em] text-muted-ink">
        {t('folders').toUpperCase()}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          // Ziel ist jede Ordnerzeile, immer — nicht erst, wenn ein `dragenter`
          // angekommen ist. Die Ereignisse kommen nicht verlässlich paarweise,
          // und ein Ziel, das erst entsteht, wenn es gesehen wurde, verliert
          // genau den Zug, der schnell genug war.
          const isTarget = row.folder !== null;
          const isOver = over !== undefined && over === row.folder && row.folder !== null;
          return (
            <li key={row.key}>
              <Link
                href={row.href}
                aria-current={current === row.key ? 'page' : undefined}
                data-folder={row.folder ?? undefined}
                onDragOver={
                  isTarget
                    ? (e) => {
                        e.preventDefault();
                        onOver?.(row.folder);
                      }
                    : undefined
                }
                onDragLeave={isTarget ? () => onOver?.(null) : undefined}
                onDrop={
                  isTarget
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Zwei Sorten Fracht auf demselben Ziel: Dateien legen
                        // etwas Neues ab, eine Zeile verschiebt Vorhandenes.
                        const documentId = e.dataTransfer.getData('application/x-kompass-document');
                        if (documentId) onDropDocument?.(row.folder, documentId);
                        else onDrop?.(row.folder, e.dataTransfer.files);
                      }
                    : undefined
                }
                className={cn(
                  // Der durchsichtige Rand ist reserviert: Sonst springt die
                  // Zeile, sobald sie beim Ziehen einen bekommt.
                  'flex h-10 items-center gap-2.5 rounded-md border-2 border-transparent px-2.5 text-sm text-ink-2',
                  current === row.key && 'bg-selected font-semibold text-selected-ink',
                  !dragging && current !== row.key && 'hover:bg-hover',
                  dragging && isTarget && 'border-dashed border-line-strong',
                  isOver && 'border-brand bg-brand-soft font-semibold text-brand-ink shadow-sm'
                )}
              >
                <row.icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {/* Nur im Ruhezustand grau: Färbt sich die Zeile, färbt sich
                    die Zahl mit — sonst bleibt sie als einziges zurück. */}
                <span className={cn('font-mono text-[12px]', current === row.key || isOver ? 'text-current' : 'text-muted-ink')}>
                  {row.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
