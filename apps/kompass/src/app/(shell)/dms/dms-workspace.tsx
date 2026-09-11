'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { DropOverlay } from './drop-overlay';
import { FolderColumn } from './folder-column';
import { ReceiveDialog } from './receive/receive-dialog';

/** Was ein Zug ins Fenster gebracht hat. */
export interface Drop {
  id: number;
  file: File | null;
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
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [files, setFiles] = useState(0);
  const [ready, setReady] = useState(false);
  const depth = useRef(0);
  const drops = useRef(0);

  const take = useCallback(
    (folder: string | null, list: FileList) => {
      const pdfs = [...list].filter(isPdf);
      drops.current += 1;
      setDrop({
        id: drops.current,
        file: pdfs[0] ?? null,
        folder,
        skipped: list.length - pdfs.length,
      });
      setOpen(true);
    },
    []
  );

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

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setDrop(null);
      if (pathname === '/dms/receive') router.replace('/dms');
    }
  };

  return (
    <>
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

      <div className="flex gap-3" data-drop={ready ? 'ready' : 'pending'}>
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
        <div className="relative min-w-0 flex-1">
          {children}
          {dragging ? <DropOverlay count={files} /> : null}
        </div>
      </div>

      {canCreate ? (
        <ReceiveDialog
          key={drop?.id ?? 'leer'}
          types={types}
          folders={folders}
          contacts={contacts}
          defaultTypeKey={defaultTypeKey}
          open={open}
          onOpenChange={change}
          drop={drop}
        />
      ) : null}
    </>
  );
}
