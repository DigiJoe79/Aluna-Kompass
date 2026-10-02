'use client';

import { CircleSlash, Files, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { DropOverlay } from '@/components/drop-overlay';
import { FolderColumn } from '@/components/folder-column';
import { EmptyState } from '@/components/empty-state';
import { FolderMoveDialog } from '@/components/folder-tree/folder-move-dialog';
import { FolderSheet } from '@/components/folder-tree/folder-sheet';
import { FolderTree, type FolderTreeProps } from '@/components/folder-tree/folder-tree';
import { useUndoableMoves, type ItemWording, type UndoableItem } from '@/components/folder-tree/use-undoable-moves';
import { AssetGrid } from '@/components/media/asset-grid';
import { useAssetDrag } from '@/components/media/use-asset-drag';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { MEDIA_MIME, carriesOutsideFiles } from '@/lib/drag-types';
import { ancestorsOf, isWithin, nameOf, namesBelow } from '@/lib/folder-tree-model';
import { usePreference } from '@/lib/preferences';
import { AssetDetailDialog } from './asset-detail-dialog';
import { ListTruncated } from './list-truncated';
import { formatBytes, mediaHref, type Folder, type Item, type ListQuery } from './types';
import { createFolderAction, deleteFolderAction, deleteMediaAction, moveFolderAction, moveMediaAction, renameFolderAction, uploadMediaAction } from './actions';

const KINDS = ['all', 'image', 'pdf'] as const;
const SORTS = ['newest', 'oldest', 'name', 'size'] as const;

/** Die Mediathek kennt keine Mehrfachauswahl (Spec § 9): Ein Zug ist eine Datei. */
const ACTIONS = {
  moveFolder: moveFolderAction,
  renameFolder: renameFolderAction,
  createFolder: createFolderAction,
  deleteFolder: deleteFolderAction,
  moveItems: async (moves: { id: string; folder: string | null; expectedFolder?: string | null }[]): Promise<ActionState> => {
    const [move] = moves;
    if (!move) return { status: 'idle' };
    return moveMediaAction(move.id, move.folder, move.expectedFolder);
  },
};

/** Der Grund einer Ablehnung, wie ihn auch die Ordnerpflege nennt: Konflikt, erstes Feld, sonst die Meldung. */
const reasonOf = (s: Extract<ActionState, { status: 'error' }>) => s.detail ?? Object.values(s.fieldErrors)[0] ?? s.message;

/** Wie lange „Ordner öffnen“ nach dem Hochladen steht — so lange wie „Rückgängig“ nach dem Verschieben. */
const UPLOADED_MS = 10_000;

/** Wie ein Ort im Toast heißt: ein Ordner beim Namen, sonst „Ohne Ordner“. */
const whereOf = (folder: string | null) => (folder === null ? { where: 'none', target: '' } : { where: 'folder', target: nameOf(folder) });

export function LibraryClient({
  title,
  query,
  folders,
  items,
  matching,
  total,
  unfiledCount,
}: {
  title: string;
  query: ListQuery;
  folders: Folder[];
  items: Item[];
  /** Wie viele Dateien zur Auswahl passen; mehr als `items`, wenn die Liste gekürzt ist. */
  matching: number;
  /** Alle Dateien, ohne Filter — der Zähler an „Alle Dateien“. */
  total: number;
  /** Dateien ohne Ordner — der Zähler an „Ohne Ordner“. */
  unfiledCount: number;
}) {
  const t = useTranslations('media');
  const tMove = useTranslations('moveDialog');
  const tTree = useTranslations('folderTree');
  const fmt = useDateFormat();
  const router = useRouter();
  const [view, setView] = usePreference('mediaView');
  /** Die Listenzeilen ziehen wie die Kacheln (gleiche Hilfe); die Zeile bleibt blass, solange sie gezogen wird. */
  const { dragging: rowDragging, dragProps } = useAssetDrag();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Der Ordner, für den „Verschieben nach…“ offen ist. */
  const [moving, setMoving] = useState<string | null>(null);
  const [, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  /** Dateien aus dem Dateimanager über der Seite (Artboard 7b); gezählt wie in der Akte, damit nichts flackert. */
  const [dragging, setDragging] = useState(false);
  /** Wie viele Dateien in der Hand liegen — `null`, wenn der Browser es nicht verrät. */
  const [files, setFiles] = useState<number | null>(null);
  /** Der Ort unter dem Zeiger, solange Dateien über dem Baum schweben — die Karte nennt ihn. */
  const [overPlace, setOverPlace] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const depth = useRef(0);

  const hrefFor = (path: string | null) => mediaHref({ ...query, folder: path, unfiled: false });
  const wording = useMemo<ItemWording<UndoableItem>>(
    () => ({
      name: (list) => (list.length === 1 ? t('toast.quoted', { title: list[0]!.title }) : t('toast.files', { count: list.length })),
      moved: (moved, skipped, target) => {
        const place = { place: t('toast.placeMoved', whereOf(target)) };
        if (skipped > 0) return t('toast.movedFilesSkipped', { count: moved.length, skipped, ...place });
        return moved.length === 1 ? t('toast.movedFile', { title: moved[0]!.title, ...place }) : t('toast.movedFiles', { count: moved.length, ...place });
      },
      alreadyThere: (skipped, _list, target) => t('toast.alreadyThere', { count: skipped, place: t('toast.placeLies', whereOf(target)) }),
      undone: (moved, back) => {
        if (back === undefined) return t('toast.undoneFilesMixed', { count: moved.length });
        const place = { place: t('toast.placeLies', whereOf(back)) };
        return moved.length === 1 ? t('toast.undoneFile', { title: moved[0]!.title, ...place }) : t('toast.undoneFiles', { count: moved.length, ...place });
      },
      undoMovedAway: (moved) => t('toast.undoMovedAway', { count: moved.length, title: moved[0]!.title }),
    }),
    [t]
  );
  const entries = useMemo(() => folders.map((f) => ({ path: f.path, count: f.assetCount })), [folders]);
  const { folders: shownFolders, selected, saving, moveFolder, renameFolder, deleteFolder, createFolder, moveItems } = useUndoableMoves({
    folders: entries,
    selected: query.unfiled ? null : query.folder,
    hrefFor,
    storageKey: 'mediaTreeExpanded',
    actions: ACTIONS,
    unit: 'files',
    wording,
  });
  const current = query.unfiled ? null : selected;

  /**
   * Lädt Dateien sofort in `folder` hoch (`null` = ohne Ordner), eine nach der
   * anderen über dieselbe Aktion wie der Knopf. Fortschritt und Ergebnis stehen
   * in einem Toast; „Ordner öffnen“ statt „Rückgängig“ — Hochladen ist kein
   * Verschieben (README § 3, Artboard 7b). Was nicht ging, nennt der Toast
   * mit Grund, auch eine Datei, die es schon gab.
   */
  const uploadFiles = async (folder: string | null, list: File[]) => {
    if (list.length === 0) return;
    const progress = (index: number) => t('drop.progress', { current: index + 1, total: list.length, name: list[index]!.name });
    const id = toast.loading(progress(0));
    let done = 0;
    const failed: string[] = [];
    for (const [index, file] of list.entries()) {
      if (index > 0) toast.loading(progress(index), { id });
      const fd = new FormData();
      fd.set('file', file);
      if (folder !== null) fd.set('folder', folder);
      try {
        const s = await uploadMediaAction(fd);
        if (s.status === 'error') failed.push(t('drop.failed', { name: file.name, reason: reasonOf(s) }));
        else if (s.status === 'success' && (s.data as { created?: boolean } | undefined)?.created === false) failed.push(t('drop.failed', { name: file.name, reason: s.message ?? '' }));
        else if (s.status === 'success') done += 1;
      } catch {
        failed.push(t('drop.failed', { name: file.name, reason: tTree('error.unexpected') }));
      }
    }
    if (done > 0) start(() => router.refresh());
    const title = done > 0 ? t('drop.done', { count: done, ...(folder === null ? { where: 'none', folder: '' } : { where: 'folder', folder: nameOf(folder) }) }) : t('drop.noneDone');
    // Geöffnet wird der Ordner ohne Suche und Typfilter — sonst fehlte womöglich gerade, was eben hochkam.
    const href = mediaHref({ ...query, q: '', kind: 'all', folder, unfiled: folder === null });
    const action = done > 0 ? { label: t('drop.openFolder'), onClick: () => router.push(href) } : undefined;
    if (failed.length === 0) {
      toast.success(title, { id, action, duration: UPLOADED_MS });
      return;
    }
    const description: ReactNode = (
      <ul>
        {failed.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    );
    toast.error(title, { id, description, action, duration: Infinity });
  };

  // Der Horcher hängt einmal am Fenster; was und wohin hochzuladen ist, liest er hier nach.
  const upload = useRef(uploadFiles);
  const dropTarget = useRef(current);
  useEffect(() => {
    upload.current = uploadFiles;
    dropTarget.current = current;
  });

  useEffect(() => {
    // Nur Dateien von außen: Ein Bild aus der Seite trägt beim Ziehen auch `Files`.
    const carriesFiles = (e: DragEvent) => carriesOutsideFiles(e.dataTransfer);
    const stop = () => {
      depth.current = 0;
      setDragging(false);
      setOverPlace(null);
    };
    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      // Safari nennt beim Ziehen nicht, wie viele Dateien kommen; 0 heißt „unbekannt“.
      setFiles(e.dataTransfer?.items.length || null);
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) stop();
    };
    // Ohne `preventDefault` öffnet der Browser die Datei selbst. In der
    // Einfangphase, damit kein Ziel darunter es verschluckt — hier wird auch
    // gemerkt, über welchem Ort des Baums der Zeiger steht.
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      const el = e.target instanceof Element ? e.target : null;
      const row = el?.closest('[role="tree"] [data-folder]');
      setOverPlace(row ? nameOf(row.getAttribute('data-folder') ?? '') : el?.closest('[data-fixed="unfiled"]') ? t('noFolder') : null);
    };
    // Der Baum stoppt ein abgelehntes oder leeres Ablegen, es erreicht `onDrop`
    // nie: Die Ablagefläche räumt deshalb schon in der Einfangphase auf. Das
    // Hochladen bleibt unten in der Bubble-Phase.
    const onDropSeen = (e: DragEvent) => {
      if (carriesFiles(e)) stop();
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      stop();
      // Was auf einer Ordnerzeile oder auf „Ohne Ordner“ landet, hat der Baum
      // schon entgegengenommen oder als gesperrt geschluckt. Er stoppt das
      // Ereignis selbst, verspricht das aber nirgends; doppelt hochgeladen
      // wäre der Fehler, den niemand sofort sieht. „Alle Dateien“ ist kein
      // Ziel des Baums: Dort gilt, was die Ablagefläche sagt — wie im Raster
      // in den geöffneten Ordner, statt die Datei stumm zu verschlucken.
      if (e.target instanceof Element && e.target.closest('[role="treeitem"], [data-fixed]:not([data-fixed="all"])')) return;
      if (e.dataTransfer?.files.length) void upload.current(dropTarget.current, [...e.dataTransfer.files]);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver, true);
    window.addEventListener('drop', onDrop);
    window.addEventListener('drop', onDropSeen, true);
    // Vor der Hydration hört niemand zu; wer das nicht sieht, zieht ins Leere.
    setReady(true);
    return () => {
      setReady(false);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver, true);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('drop', onDropSeen, true);
    };
  }, [t]);
  const movingTotal = moving === null ? 0 : shownFolders.filter((f) => isWithin(f.path, moving)).reduce((sum, f) => sum + f.count, 0);

  const detail = items.find((it) => it.id === detailId) ?? null;

  /** Aus dem Detaildialog. `quiet`: Den Fehler nennt der Dialog „Verschieben nach…“ selbst. */
  const move = async (id: string, folder: string | null): Promise<ActionState> => {
    const item = items.find((it) => it.id === id);
    if (!item) return { status: 'idle' };
    const s = await moveItems([{ id, from: item.folder, title: item.filename }], folder, { quiet: true });
    if (s.status === 'success') setDetailId(null);
    return s;
  };

  const requestDelete = (id: string) => {
    setDetailId(null);
    setConfirmId(id);
  };

  /** Der Ort einer Datei unter dem geöffneten Ordner, als Namen mit „›“; leer heißt „direkt hier“ (Spec § 9). */
  const placeOf = (folder: string | null) => (folder === null ? t('noFolder') : namesBelow(folder, current).join(' › '));

  /** Was beide Bäume teilen: die Spalte am Schreibtisch und das Sheet am Telefon. */
  const treeProps = {
    folders: shownFolders,
    mode: 'navigate',
    selected: current,
    fixed: [
      { key: 'all', label: t('root'), icon: Files, count: total, href: hrefFor(null), dropTarget: false, folder: null, current: !query.unfiled && current === null },
      { key: 'unfiled', label: t('noFolder'), icon: CircleSlash, count: unfiledCount, href: mediaHref({ ...query, folder: null, unfiled: true }), dropTarget: true, folder: null, current: query.unfiled },
    ],
    hrefFor,
    acceptsItems: MEDIA_MIME,
    canDrop: true,
    // Die Seite verlangt `media.upload`, und das ist zugleich das Recht für Ordner (Handoff § 8.5).
    canManage: true,
    saving,
    onCreate: createFolder,
    onRename: renameFolder,
    onDelete: deleteFolder,
    onRequestMove: setMoving,
    onMove: async (item, folder) => {
      if (item.kind === 'folder') return moveFolder(item.path, folder);
      const id = item.kind === 'assets' ? item.ids[0] : undefined;
      if (item.kind !== 'assets' || id === undefined) return { status: 'idle' };
      // Unbekannt (aus einem anderen Tab): Herkunft und Name aus dem Ziehgut.
      const known = items.find((it) => it.id === id);
      return moveItems([{ id, from: known ? known.folder : (item.sources[0] ?? null), title: known?.filename ?? item.label }], folder);
    },
    unit: { one: tMove('unit.files.one'), many: tMove('unit.files.many') },
    storageKey: 'mediaTreeExpanded',
    emptyHint: t('treeEmpty'),
  } satisfies FolderTreeProps;

  // Der Ortsknopf am Telefon nennt, was die Spalte am Schreibtisch zeigt: Ort und Summe.
  const place = query.unfiled
    ? { path: [], title: t('noFolder'), count: unfiledCount }
    : current === null
      ? { path: [], title: t('root'), count: total }
      : {
          path: ancestorsOf(current).map(nameOf),
          title: nameOf(current),
          count: shownFolders.filter((f) => isWithin(f.path, current)).reduce((sum, f) => sum + f.count, 0),
        };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={title}
        actions={
          <>
            {uploading ? (
              <span aria-live="polite" className="text-[13px] text-ink-2">
                {t('uploading')}
              </span>
            ) : null}
            <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
              <Upload aria-hidden />
              {t('uploadButton')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              aria-label={t('upload')}
              tabIndex={-1}
              accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                e.target.value = '';
                setUploading(true);
                // Derselbe Weg wie beim Ablegen: gleicher Toast, und eine Datei, die es schon gab, steht als Fehler da.
                void uploadFiles(current, [file]).finally(() => setUploading(false));
              }}
            />
          </>
        }
      />

      {/* Dieselbe Spalte wie in der Akte (README § 3, Artboard 7): bis an die Ränder des Arbeitsbereichs, oben mit der Linie unter dem Seitenkopf (Artboard 1). */}
      <div className="-mx-(--shell-pad) -mb-(--shell-pad) flex min-h-0 flex-1 border-t border-line" data-drop={ready ? 'ready' : 'pending'}>
        <FolderColumn className="z-3 flex w-[272px] max-sm:hidden shrink-0 flex-col border-r border-line bg-surface px-2.5 py-3">
          <FolderTree
            {...treeProps}
            onDropFiles={(folder, list) => {
              setDragging(false);
              setOverPlace(null);
              depth.current = 0;
              void uploadFiles(folder, [...list]);
            }}
          />
        </FolderColumn>

        <div className="relative min-w-0 flex-1 overflow-auto p-5">
          <FolderSheet {...place} place={query.unfiled ? 'unfiled' : (current ?? '')} className="sm:hidden">
            <FolderTree {...treeProps} density="touch" />
          </FolderSheet>

          <form method="get" action="/admin/media" className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
            {query.unfiled ? <input type="hidden" name="unfiled" value="1" /> : current !== null ? <input type="hidden" name="folder" value={current} /> : null}
            <Input type="search" name="q" defaultValue={query.q} placeholder={t('searchPlaceholder')} aria-label={t('search')} className="min-w-0 flex-1" />
            <label className="flex items-center gap-2 text-ink-2">
              {t('kind.label')}
              <Select name="kind" defaultValue={query.kind} className="w-auto">
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2 text-ink-2">
              {t('sort.label')}
              <Select name="sort" defaultValue={query.sort} className="w-auto">
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}`)}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" size="sm" variant="secondary">
              {t('filter')}
            </Button>
          </form>

          <div className="mb-4 flex items-center justify-end gap-4">
            <div className="flex overflow-hidden rounded-md border border-line text-[13px]">
              {(['list', 'grid'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1 ${view === v ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}>
                  {t(`view.${v}`)}
                </button>
              ))}
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState title={t('emptyTitle')} text={t('empty')} />
          ) : view === 'grid' ? (
            <AssetGrid
              items={items.map((it) => ({ id: it.id, filename: it.filename, mimeType: it.mimeType, used: it.references.length > 0, place: current === null ? '' : placeOf(it.folder), folder: it.folder }))}
              onOpen={(it) => setDetailId(it.id)}
              draggable
            />
          ) : (
            <table className="w-full text-[14px]">
              <thead className="text-left text-ink-2">
                <tr>
                  <th className="py-2">{t('columns.file')}</th>
                  <th>{t('columns.folder')}</th>
                  <th>{t('columns.size')}</th>
                  <th>{t('columns.uploadedAt')}</th>
                  <th>{t('columns.usage')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it.id}
                    {...dragProps(it)}
                    className={`h-row cursor-pointer border-b border-line-2 hover:bg-row-hover ${rowDragging === it.id ? 'opacity-50' : ''}`}
                    onClick={() => setDetailId(it.id)}
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailId(it.id);
                        }}
                      >
                        {it.mimeType.startsWith('image/') ? (
                          <img src={`/media/${it.id}/preview`} alt="" loading="lazy" draggable={false} className="size-8 shrink-0 rounded border border-line object-cover" />
                        ) : (
                          <span className="grid size-8 shrink-0 place-items-center rounded border border-line bg-surface-2 text-[10px] uppercase text-ink-2">{it.filename.split('.').at(-1)}</span>
                        )}
                        <span className="font-mono text-[13px]">{it.filename}</span>
                      </button>
                    </td>
                    <td data-folder-cell className="text-ink-2">
                      {placeOf(it.folder)}
                    </td>
                    <td>{formatBytes(it.bytes)}</td>
                    <td className="text-ink-2">{fmt.date(it.createdAt)}</td>
                    <td>{it.references.length === 0 ? <span className="text-ink-2">{t('unused')}</span> : it.references.map((r) => r.label).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <ListTruncated shown={items.length} matching={matching} />

          {dragging ? (
            <DropOverlay
              count={files}
              badge={null}
              title={
                overPlace === null
                  ? files === null
                    ? t('drop.overlayTitleUnknown')
                    : t('drop.overlayTitle', { count: files })
                  : files === null
                    ? t('drop.overlayFolderUnknown', { folder: overPlace })
                    : t('drop.overlayFolder', { count: files, folder: overPlace })
              }
              hint={t('drop.overlayHint', current === null ? { where: 'none', current: '' } : { where: 'folder', current: nameOf(current) })}
            />
          ) : null}
        </div>
      </div>

      <AssetDetailDialog item={detail} folders={shownFolders} assetFolder={detail?.folder ?? null} onOpenChange={(open) => !open && setDetailId(null)} onMove={move} onDelete={requestDelete} />

      {moving !== null ? (
        <FolderMoveDialog
          open
          onOpenChange={(next) => {
            if (!next) setMoving(null);
          }}
          subject={{ kind: 'folder', path: moving, total: movingTotal }}
          folders={shownFolders}
          rootLabel={tMove('root')}
          unit={{ one: tMove('unit.files.one'), many: tMove('unit.files.many') }}
          // Den Fehler nennt der Dialog selbst; ein Toast daneben wäre doppelt.
          onConfirm={(target) => moveFolder(moving, target, { quiet: true })}
        />
      ) : null}

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => !open && setConfirmId(null)}
        title={t('confirmDelete')}
        description={t('confirmDeleteBody')}
        confirmLabel={t('delete')}
        destructive
        action={async () => {
          if (!confirmId) return { status: 'idle' } as ActionState;
          const state = await deleteMediaAction(confirmId);
          if (state.status === 'success') start(() => router.refresh());
          setConfirmId(null);
          return state;
        }}
      />
    </div>
  );
}
