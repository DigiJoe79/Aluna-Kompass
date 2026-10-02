'use client';

import { File as FileIcon, Folder, Image as ImageIcon } from 'lucide-react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export interface DragPreviewProps {
  kind: 'document' | 'asset' | 'folder';
  /** Betreff, Dateiname, „3 Dokumente“ oder Ordnername. */
  title: string;
  /** Ordner: die Summe („9 Dokumente“). */
  detail?: string;
  /** Mehrere Dokumente: gestapelt. */
  stacked?: boolean;
}

/**
 * Das Ziehbild (HANDOFF § 3.6, Board K5): ein Element, gestapelt mit Anzahl,
 * Ordner mit Summe. Die ⊘-Marke über einem gesperrten Ziel fehlt: Der Browser
 * fotografiert das Bild beim Start, danach lässt es sich nicht mehr ändern —
 * die Sperre zeigt die Zeile selbst.
 */
export function DragPreview({ kind, title, detail, stacked = false }: DragPreviewProps) {
  const Icon = kind === 'folder' ? Folder : kind === 'asset' ? ImageIcon : FileIcon;
  const card = (
    <div className="relative flex w-max max-w-[320px] items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink shadow-md">
      <Icon className="size-[15px] shrink-0 text-muted-ink" aria-hidden />
      <span className="truncate font-semibold">{title}</span>
      {detail ? <span className="shrink-0 text-muted-ink">{detail}</span> : null}
    </div>
  );
  if (!stacked) return <div className="p-2">{card}</div>;
  // Zwei Karten dahinter, je 3 px versetzt — der Stapel sagt „mehrere“, die Zahl steht im Text.
  return (
    <div className="p-2 pr-3.5 pb-3.5">
      <div className="relative isolate w-max">
        <div aria-hidden className="absolute inset-0 -z-1 translate-1.5 rounded-md border border-line-strong bg-surface-2" />
        <div aria-hidden className="absolute inset-0 -z-1 translate-0.75 rounded-md border border-line-strong bg-surface" />
        {card}
      </div>
    </div>
  );
}

/**
 * Setzt das eigene Ziehbild. Muss synchron im `dragstart` laufen; das Element
 * steht dafür kurz außerhalb des Bildschirms im Dokument (sonst fotografiert
 * Chrome nichts) und verschwindet gleich danach wieder.
 */
export function setDragPreview(transfer: DataTransfer | null | undefined, props: DragPreviewProps) {
  if (!transfer || typeof transfer.setDragImage !== 'function') return;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.top = '-1000px';
  host.style.left = '0';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<DragPreview {...props} />));
  transfer.setDragImage(host, 16, 16);
  setTimeout(() => {
    root.unmount();
    host.remove();
  }, 0);
}
