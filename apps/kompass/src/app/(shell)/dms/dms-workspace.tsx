'use client';

import { Files, Inbox, Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { FolderMoveDialog } from '@/components/folder-tree/folder-move-dialog';
import { FolderSheet } from '@/components/folder-tree/folder-sheet';
import { FolderTree, type FolderTreeProps } from '@/components/folder-tree/folder-tree';
import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { DOCUMENTS_MIME, carriesOutsideFiles } from '@/lib/drag-types';
import { ancestorsOf, isWithin, nameOf, type FolderEntry } from '@/lib/folder-tree-model';
import { DocumentMovesContext, type DocumentMoves, type MovableDocument } from './document-moves';
import { DropOverlay } from '@/components/drop-overlay';
import { FolderColumn } from '@/components/folder-column';
import { ExportDialog } from './export-dialog';
import { ReceiveDialog } from './receive/receive-dialog';
import { useFolderMoves, type DocumentMoveItem } from './use-folder-moves';
import { folderHref } from './folder-href';

/** Was ein Zug ins Fenster gebracht hat. */
export interface Drop {
  id: number;
  /** Alle PDFs des Zuges, in der Reihenfolge, in der sie abgearbeitet werden. */
  files: File[];
  folder: string | null;
  /** Die Namen der Dateien, die keine PDFs waren und deshalb liegen blieben. */
  skippedNames: string[];
}

const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

/**
 * Die Akte als Arbeitsfläche: Ordner links, Liste rechts, und beides zusammen
 * ein Ziel für Dateien aus dem Dateimanager. Wer eine Datei auf einen Ordner
 * zieht, hat sie damit schon einsortiert; wer sie irgendwo sonst fallen lässt,
 * legt sie in den Eingangskorb.
 */
export function DmsWorkspace({
  folders,
  inboxCount,
  total,
  canCreate,
  canManage,
  areaOnly,
  canExport,
  currentFolder,
  currentYear,
  types,
  canCreateContact,
  initialSender,
  initialAbout,
  defaultTypeKey,
  receiveOpen,
  children,
}: {
  folders: FolderEntry[];
  inboxCount: number;
  total: number;
  canCreate: boolean;
  /** Mit `dms.manage`: Ordner im Baum anlegen, umbenennen, verschieben, löschen. */
  canManage: boolean;
  /** Nur mit Bereichsrecht, ohne `dms.view`: Der Baum ist kurz, ein Satz darunter sagt warum (Artboard 9b). */
  areaOnly: boolean;
  /** Nur mit `documents.export`: der Knopf zum Bündeln der Akte. */
  canExport: boolean;
  /**
   * Der gerade angezeigte Ordner — Vorbelegung für „Diesen Ordner“. Vom
   * Server geprüft: Gibt es den Ordner aus der Adresse nicht mehr, ist es der
   * nächste vorhandene Vorfahr (oder `null`).
   */
  currentFolder: string | null;
  /** Vorbelegung des Jahrgangs, von der Serveruhr. */
  currentYear: number;
  types: { key: string; label: string }[];
  canCreateContact: boolean;
  /** Von der Kontaktseite vorbelegter Absender. */
  initialSender?: { id: string; name: string } | null;
  /** Von der Seite eines Bezugs vorbelegtes „Betrifft“. */
  initialAbout?: { entityType: string; entityId: string; label: string } | null;
  defaultTypeKey: string;
  /** Der Deep-Link `/dms/receive` zeigt denselben Bildschirm mit offenem Dialog. */
  receiveOpen?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('dms');
  const tTree = useTranslations('folderTree');
  const tMove = useTranslations('moveDialog');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const isInbox = params.get('inbox') === '1';
  const hrefFor = (path: string | null) => folderHref(new URLSearchParams(params.toString()), { folder: path });
  // Die Adresse sofort (ein Klick markiert, bevor der Server antwortet), aber
  // nur, wenn es den Ordner gibt; sonst, was der Server stattdessen öffnet.
  const known = useMemo(() => new Set(folders.flatMap((f) => [...ancestorsOf(f.path), f.path])), [folders]);
  const requested = params.get('folder') || null;
  const openFolder = isInbox ? null : requested && known.has(requested) ? requested : currentFolder;
  const { folders: shownFolders, selected: selectedFolder, saving, placed, moveFolder, renameFolder, deleteFolder, createFolder, moveDocuments } = useFolderMoves({
    folders,
    selected: openFolder,
    hrefFor,
  });
  /** Der Ordner, für den „Verschieben nach…“ offen ist. */
  const [moving, setMoving] = useState<string | null>(null);
  /** Der Ordner, für den „Als Paket exportieren“ offen ist. */
  const [exporting, setExporting] = useState<string | null>(null);
  const movingTotal = moving === null ? 0 : shownFolders.filter((f) => isWithin(f.path, moving)).reduce((sum, f) => sum + f.count, 0);

  /**
   * Die Zeilen, die die Liste gezeigt hat: Ort und Betreff je ID. Der Baum
   * bekommt beim Ablegen nur IDs; was er braucht, steht hier. Nach einem Zug
   * zieht der Ort mit, auch für Zeilen, die die Liste danach nicht mehr zeigt.
   */
  const rows = useRef(new Map<string, MovableDocument>());
  /** Die Dokumente, für die „Verschieben nach…“ offen ist. */
  const [movingDocuments, setMovingDocuments] = useState<MovableDocument[] | null>(null);
  const documentMoves = useMemo<DocumentMoves>(
    () => ({
      placed,
      remember: (list) => {
        for (const row of list) rows.current.set(row.id, row);
      },
      requestMove: (list) => setMovingDocuments([...list]),
    }),
    [placed]
  );
  const moveDocumentsTo = async (items: DocumentMoveItem[], target: string | null, options?: { quiet?: boolean }) => {
    const result = await moveDocuments(items, target, options);
    if (result.status === 'success') {
      for (const item of items) rows.current.set(item.id, { id: item.id, folder: target, subject: item.title, direction: item.direction });
    }
    return result;
  };

  const [open, setOpen] = useState(!!receiveOpen);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [index, setIndex] = useState(0);
  const [asking, setAsking] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Wie viele Dateien in der Hand liegen — `null`, wenn der Browser es nicht verrät. */
  const [files, setFiles] = useState<number | null>(null);
  /** Der Ordner unter dem Zeiger, solange Dateien darüber gezogen werden — die Karte nennt ihn (Artboard 2f). */
  const [overFolder, setOverFolder] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const depth = useRef(0);
  const drops = useRef(0);

  const take = useCallback((folder: string | null, list: FileList) => {
    const pdfs = [...list].filter(isPdf);
    drops.current += 1;
    setDrop({ id: drops.current, files: pdfs, folder, skippedNames: [...list].filter((file) => !isPdf(file)).map((file) => file.name) });
    setIndex(0);
    setOpen(true);
  }, []);

  /**
   * Eine Datei ist abgelegt. Warten noch welche, rückt der Dialog vor, statt
   * sich zu schliessen — der Zielordner bleibt, die übrigen Felder füllen die
   * Einsortierregeln neu.
   */
  const filed = () => {
    const rest = drop ? drop.files.length - index - 1 : 0;
    if (rest > 0) {
      setIndex((i) => i + 1);
      router.refresh();
      return;
    }
    setOpen(false);
    setDrop(null);
    router.refresh();
  };

  useEffect(() => {
    if (!canCreate) return;

    // Nur Dateien von außen: Ein Bild aus der Seite trägt beim Ziehen auch `Files`.
    const carriesFiles = (e: DragEvent) => carriesOutsideFiles(e.dataTransfer);
    const stop = () => {
      depth.current = 0;
      setDragging(false);
      setOverFolder(null);
    };

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // Gezählt statt geschaltet: `dragenter` und `dragleave` kommen beim
      // Überfahren von Kindelementen paarweise durcheinander, und ein einfaches
      // Flag lässt das Overlay flackern.
      depth.current += 1;
      // Safari verrät beim Ziehen nur, dass Dateien kommen, nicht wie viele:
      // `items` ist leer, erst `drop` bringt sie. Eine 0 heisst also „unbekannt“.
      setFiles(e.dataTransfer?.items.length || null);
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) stop();
    };
    // Ohne `preventDefault` öffnet der Browser das PDF selbst und die Seite ist weg.
    // In der Einfangphase, damit kein Ziel darunter es verschluckt: Hier wird
    // auch gemerkt, über welchem Ordner des Baums der Zeiger steht.
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      const row = e.target instanceof Element ? e.target.closest('[role="tree"] [data-folder]') : null;
      setOverFolder(row?.getAttribute('data-folder') ?? null);
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
      // Was auf einer Zeile des Ordnerbaums landet, hat der Baum schon
      // entgegengenommen (oder als gesperrt geschluckt). Er stoppt das
      // Ereignis zwar selbst, verspricht das aber nirgends — und ein zweiter
      // Empfangsdialog für dieselbe Datei wäre der Fehler, den niemand sofort
      // sieht. Zwischen oder unter den Zeilen ist kein Ziel: Das geht wie
      // überall sonst in den Eingangskorb.
      if (e.target instanceof Element && e.target.closest('[role="treeitem"]')) return;
      if (e.dataTransfer?.files.length) take(null, e.dataTransfer.files);
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
  }, [canCreate, take]);

  /** Wie viele Dateien der Warteschlange noch offen sind. */
  const pending = drop ? drop.files.length - index : 0;

  const close = () => {
    setOpen(false);
    setAsking(false);
    setDrop(null);
    setIndex(0);
    if (pathname === '/dms/receive') router.replace('/dms');
  };

  const change = (next: boolean) => {
    if (next) {
      setOpen(true);
      return;
    }
    // Wer mitten in einer Warteschlange abbricht, wirft den Rest weg. Vor dem
    // ersten Ablegen ist noch nichts geschehen — da fragt niemand.
    if (index > 0 && pending > 0) {
      setAsking(true);
      return;
    }
    close();
  };

  /** Was beide Bäume teilen: die Spalte am Schreibtisch und das Sheet am Telefon. */
  const treeProps = {
    folders: shownFolders,
    mode: 'navigate',
    selected: selectedFolder,
    fixed: [
      { key: 'all', label: t('allDocuments'), icon: Files, count: total, href: hrefFor(null), dropTarget: false, folder: null, current: !isInbox && !selectedFolder },
      {
        key: 'inbox',
        label: t('inbox'),
        icon: Inbox,
        count: inboxCount,
        href: folderHref(new URLSearchParams(params.toString()), { folder: null, inbox: true }),
        dropTarget: true,
        folder: null,
        current: isInbox,
        // Ein Ausgang ohne Ordner läge nicht im Eingangskorb, sondern unter „Alle Dokumente“.
        refuse: (item) =>
          item.kind === 'documents' && item.ids.some((id) => rows.current.get(id)?.direction === 'outgoing') ? 'incomingOnly' : null,
      },
    ],
    hrefFor,
    acceptsItems: DOCUMENTS_MIME,
    canManage,
    saving,
    onCreate: createFolder,
    onRename: renameFolder,
    onDelete: deleteFolder,
    onRequestMove: setMoving,
    extraMenuItems: canExport
      ? (path) => (
          <DropdownMenuItem onSelect={() => setExporting(path)}>
            <Package className="text-muted-ink" aria-hidden />
            {tTree('export')}
          </DropdownMenuItem>
        )
      : undefined,
    unit: { one: t('documentUnit.one'), many: t('documentUnit.many') },
    storageKey: 'dmsTreeExpanded',
  } satisfies FolderTreeProps;

  // Der Ortsknopf am Telefon nennt, was die Spalte am Schreibtisch zeigt: Ort und Summe (wie die Mediathek). Die
  // Zahl der Treffer steht in der Zählzeile der Leiste, auch am Telefon.
  const place = isInbox
    ? { path: [], title: t('inbox'), count: inboxCount }
    : selectedFolder === null
      ? { path: [], title: t('allDocuments'), count: total }
      : {
          path: ancestorsOf(selectedFolder).map(nameOf),
          title: nameOf(selectedFolder),
          count: shownFolders.filter((f) => isWithin(f.path, selectedFolder)).reduce((sum, f) => sum + f.count, 0),
        };

  return (
    <DocumentMovesContext value={documentMoves}>
      <div className="flex min-h-full flex-col">
        <PageHeader
          title={t('title')}
          description={t('description')}
          actions={
            <>
              {canExport ? <ExportDialog canExport={canExport} folder={selectedFolder} currentYear={currentYear} /> : null}
              {canCreate ? (
                <>
                  {/* Der primäre Knopf schliesst die Gruppe ab. Und beides auf
                      Feldhöhe: Es sind die Hauptwege des Bildschirms, keine
                      Nebenaktionen. */}
                  <Button variant="outline" onClick={() => setOpen(true)}>
                    {t('receivePost')}
                  </Button>
                  <Link href={selectedFolder ? `/dms/new?folder=${encodeURIComponent(selectedFolder)}` : '/dms/new'} className={buttonVariants({ variant: 'default' })}>
                    {t('newDraft')}
                  </Link>
                </>
              ) : null}
            </>
          }
        />

        {/* Bis an die Ränder des Arbeitsbereichs: Die Ordnerspalte ist eine
            Spalte, keine Karte — beim Ziehen ist sie die helle Fläche gegen das
            abgedunkelte Feld daneben, und die Grenze muss bis unten tragen. Die Linie
            oben trennt sie vom Seitenkopf (Artboard 1). */}
        <div className="-mx-(--shell-pad) -mb-(--shell-pad) flex min-h-0 flex-1 border-t border-line" data-drop={ready ? 'ready' : 'pending'}>
          <FolderColumn className="z-3 flex w-[272px] max-sm:hidden shrink-0 flex-col border-r border-line bg-surface px-2.5 py-3">
            <FolderTree
              {...treeProps}
              note={areaOnly ? tTree('areaNote') : undefined}
              canDrop={canCreate}
              onDropFiles={
                canCreate
                  ? (folder, list) => {
                      setDragging(false);
                      depth.current = 0;
                      take(folder, list);
                    }
                  : undefined
              }
              onMove={async (item, folder) => {
                if (item.kind === 'folder') return moveFolder(item.path, folder);
                if (item.kind !== 'documents' || item.ids.length === 0) return { status: 'idle' };
                const items = item.ids.map((id, i) => {
                  const row = rows.current.get(id);
                  // Unbekannt (aus einem anderen Tab): als Eingang — der Eingangskorb hat es dann schon zugelassen.
                  return { id, from: row ? row.folder : (item.sources[i] ?? null), title: row?.subject ?? item.label, direction: row?.direction ?? 'incoming' };
                });
                return moveDocumentsTo(items, folder);
              }}
            />
          </FolderColumn>
          <div className="relative min-w-0 flex-1 overflow-auto p-5">
            <FolderSheet {...place} place={isInbox ? 'inbox' : (selectedFolder ?? '')} className="sm:hidden">
              <FolderTree {...treeProps} density="touch" note={areaOnly ? tTree('areaNote') : undefined} />
            </FolderSheet>
            {children}
            {dragging ? (
              <DropOverlay
                count={files}
                {...(overFolder === null
                  ? {}
                  : {
                      title: files === null ? t('drop.overlayFolderUnknown', { folder: nameOf(overFolder) }) : t('drop.overlayFolder', { count: files, folder: nameOf(overFolder) }),
                      hint: t('drop.overlayHintFolder'),
                    })}
              />
            ) : null}
          </div>
        </div>

        {canCreate ? (
          <ReceiveDialog
            key={`${drop?.id ?? 'leer'}-${index}`}
            types={types}
            folders={shownFolders}
            canCreateContact={canCreateContact}
            initialSender={initialSender}
            initialAbout={initialAbout}
            defaultTypeKey={defaultTypeKey}
            open={open}
            onOpenChange={change}
            drop={drop}
            index={index}
            onFiled={filed}
          />
        ) : null}

        {moving !== null ? (
          <FolderMoveDialog
            open
            onOpenChange={(next) => {
              if (!next) setMoving(null);
            }}
            subject={{ kind: 'folder', path: moving, total: movingTotal }}
            folders={shownFolders}
            rootLabel={tMove('root')}
            // Den Fehler nennt der Dialog selbst; ein Toast daneben wäre doppelt.
            onConfirm={(target) => moveFolder(moving, target, { quiet: true })}
          />
        ) : null}

        {movingDocuments !== null ? (
          <FolderMoveDialog
            open
            onOpenChange={(next) => {
              if (!next) setMovingDocuments(null);
            }}
            subject={{
              kind: 'documents',
              ids: movingDocuments.map((d) => d.id),
              title: movingDocuments.length === 1 ? movingDocuments[0]!.subject : '',
              sources: movingDocuments.reduce<Record<string, number>>((acc, d) => {
                const key = d.folder ?? '';
                acc[key] = (acc[key] ?? 0) + 1;
                return acc;
              }, {}),
            }}
            folders={shownFolders}
            // Ohne Ordner ist der Eingangskorb nur für Eingänge; sonst „Kein Ordner“.
            rootLabel={movingDocuments.every((d) => d.direction === 'incoming') ? t('inbox') : t('noFolder')}
            rootKind={movingDocuments.every((d) => d.direction === 'incoming') ? 'inbox' : 'none'}
            onConfirm={(target) =>
              moveDocumentsTo(
                movingDocuments.map((d) => ({ id: d.id, from: d.folder, title: d.subject, direction: d.direction })),
                target,
                { quiet: true }
              )
            }
          />
        ) : null}

        {exporting !== null ? (
          <ExportDialog
            key={exporting}
            canExport={canExport}
            folder={exporting}
            currentYear={currentYear}
            open
            onOpenChange={(next) => {
              if (!next) setExporting(null);
            }}
          />
        ) : null}

        <ConfirmDialog
          open={asking}
          onOpenChange={setAsking}
          title={t('drop.discardTitle')}
          description={t('drop.discardDescription', { count: pending })}
          confirmLabel={t('drop.discardConfirm')}
          destructive
          action={async () => {
            close();
            return { status: 'success' };
          }}
        />
      </div>
    </DocumentMovesContext>
  );
}
