'use client';

import { FileText, FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { formatFileSize, type Device } from '@/lib/finance/expenses';
import { cn } from '@/lib/utils';
import { DeviceHint } from './device-hint';

export type PdfFieldError = { kind: 'photo' | 'notPdf' | 'tooLarge'; fileName: string } | { kind: 'server'; detail: string };

/**
 * Das PDF-Feld einer Belegposition (Designer-README 3a): eine Ablagefläche mit
 * „PDF wählen“, `accept="application/pdf"` und **kein** `capture` — ein Foto
 * wird nie zum Beleg. Darunter immer die Kurzanleitung zum Scannen. Nach der
 * Wahl wird das Feld zur Dateizeile mit „ersetzen“, die Anleitung
 * verschwindet. Ablehnungen stehen am Feld (`role="alert"`) mit dem
 * Dateinamen und dem Satz, dass die Eingaben stehen bleiben.
 */
export function PdfField({
  positionKey,
  fileName,
  fileSize,
  pageCount = null,
  documentNumber,
  uploading,
  error,
  device,
  maxBytes,
  onPick,
}: {
  positionKey: string;
  fileName: string | null;
  fileSize: number | null;
  /** Seitenzahl (Design 3a „1 Seite · 184 KB“) — fehlt sie, bleibt es bei der Größe. */
  pageCount?: number | null;
  documentNumber: string | null;
  uploading: boolean;
  error: PdfFieldError | null;
  device: Device;
  maxBytes: number;
  onPick: (file: File) => void;
}) {
  const t = useTranslations('finance.expenses.new.pdf');
  const inputRef = useRef<HTMLInputElement>(null);
  const filed = documentNumber !== null || fileName !== null;
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-2">
      {filed ? (
        <div data-testid="receipt-file" className="flex min-h-[var(--field-h)] items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2">
          <FileText className="size-5 shrink-0 text-muted-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            {/* 08 B13: Nach dem Neuladen fehlt der Dateiname — dann ist „abgelegt als …“ der Titel und steht nicht noch einmal darunter. */}
            <p className="truncate text-body text-ink">{fileName ?? (documentNumber ? t('filed', { number: documentNumber }) : null)}</p>
            {fileName !== null ? (
              <p className="text-hint text-muted-ink">
                {[pageCount !== null ? t('pages', { count: pageCount }) : null, fileSize !== null ? formatFileSize(fileSize) : null, documentNumber ? t('filed', { number: documentNumber }) : null].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
          <Button type="button" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {t('replace')}
          </Button>
        </div>
      ) : (
        // Eine Form für die Ablage eines Belegs: gestrichelte Fläche mit Textlink wie `ReceiptDrop` (Runde 3, 101). Ein
        // Ziehen legt die erste Datei ab; die Prüfung (Foto, kein PDF, zu groß) bleibt bei `onPick` und nennt die Datei.
        // Layout ohne dauerhaften Test (eine Stelle).
        <div
          role="presentation"
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file && !uploading) onPick(file);
          }}
          className={cn(
            'flex h-24 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-center text-meta',
            dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface',
          )}
        >
          <FileUp className="size-5 text-muted-ink" aria-hidden />
          <Button id={`pdf-${positionKey}`} type="button" variant="link" className="h-auto px-0 font-semibold text-ink underline underline-offset-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? t('uploading') : t('choose')}
          </Button>
        </div>
      )}
      <input
        ref={inputRef}
        data-testid="receipt-file-input"
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
      {error ? (
        error.kind === 'server' ? (
          <Notice level="refuse">{error.detail}</Notice>
        ) : (
          <Notice level="refuse" title={error.kind === 'tooLarge' ? t('tooLarge', { limit: formatFileSize(maxBytes) }) : t(error.kind)}>
            <p>{t('file', { name: error.fileName })}</p>
            <p>{t('keep')}</p>
          </Notice>
        )
      ) : null}
      {filed ? null : <DeviceHint device={device} />}
    </div>
  );
}
