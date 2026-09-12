'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { DropOverlay } from './drop-overlay';
import { FolderColumn } from './folder-column';
import { ReceiveDialog } from './receive/receive-dialog';

/** Was ein Zug ins Fenster gebracht hat. */
export interface Drop {
  id: number;
  /** Alle PDFs des Zuges, in der Reihenfolge, in der sie abgearbeitet werden. */
  files: File[];
  folder: string | null;
  /** Wie viele Dateien keine PDFs waren und deshalb liegen blieben. */
  skipped: number;
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
  counts,
  inboxCount,
  total,
  canCreate,
  types,
  contacts,
  defaultTypeKey,
  receiveOpen,
  children,
}: {
  folders: string[];
  counts: Record<string, number>;
  inboxCount: number;
  total: number;
  canCreate: boolean;
  types: { key: string; label: string }[];
  contacts: { id: string; name: string }[];
  defaultTypeKey: string;
  /** Der Deep-Link `/dms/receive` zeigt denselben Bildschirm mit offenem Dialog. */
  receiveOpen?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('dms');
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(!!receiveOpen);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [index, setIndex] = useState(0);
  const [asking, setAsking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [files, setFiles] = useState(0);
  const [ready, setReady] = useState(false);
  const depth = useRef(0);
  const drops = useRef(0);

  const take = useCallback((folder: string | null, list: FileList) => {
    const pdfs = [...list].filter(isPdf);
    drops.current += 1;
    setDrop({ id: drops.current, files: pdfs, folder, skipped: list.length - pdfs.length });
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

    const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes('Files');
    const stop = () => {
      depth.current = 0;
      setDragging(false);
      setOver(null);
    };

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // Gezählt statt geschaltet: `dragenter` und `dragleave` kommen beim
      // Überfahren von Kindelementen paarweise durcheinander, und ein einfaches
      // Flag lässt das Overlay flackern.
      depth.current += 1;
      setFiles(e.dataTransfer?.items.length ?? 1);
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) stop();
    };
    // Ohne `preventDefault` öffnet der Browser das PDF selbst und die Seite ist weg.
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      stop();
      if (e.dataTransfer?.files.length) take(null, e.dataTransfer.files);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    // Vor der Hydration hört niemand zu; wer das nicht sieht, zieht ins Leere.
    setReady(true);
    return () => {
      setReady(false);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
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

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate ? (
            <>
              <Link href="/dms/new" className={buttonVariants({ variant: 'default', size: 'sm' })}>
                {t('newDraft')}
              </Link>
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                {t('receivePost')}
              </Button>
            </>
          ) : null
        }
      />

      {/* Bis an die Ränder des Arbeitsbereichs: Die Ordnerspalte ist eine
          Spalte, keine Karte — beim Ziehen ist sie die helle Fläche gegen das
          abgedunkelte Feld daneben, und die Grenze muss bis unten tragen. */}
      <div className="-mx-6 -mb-6 flex min-h-0 flex-1" data-drop={ready ? 'ready' : 'pending'}>
        <FolderColumn
          folders={folders}
          counts={counts}
          inboxCount={inboxCount}
          total={total}
          dragging={dragging}
          over={over}
          onOver={setOver}
          onDrop={(folder, list) => {
            setDragging(false);
            setOver(null);
            depth.current = 0;
            take(folder, list);
          }}
        />
        <div className="relative min-w-0 flex-1 overflow-auto p-5">
          {children}
          {dragging ? <DropOverlay count={files} /> : null}
        </div>
      </div>

      {canCreate ? (
        <ReceiveDialog
          key={`${drop?.id ?? 'leer'}-${index}`}
          types={types}
          folders={folders}
          contacts={contacts}
          defaultTypeKey={defaultTypeKey}
          open={open}
          onOpenChange={change}
          drop={drop}
          index={index}
          onFiled={filed}
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
  );
}
