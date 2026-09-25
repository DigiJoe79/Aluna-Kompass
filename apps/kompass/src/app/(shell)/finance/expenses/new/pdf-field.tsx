'use client';

import { FileText, FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { formatFileSize, type Device } from '@/lib/finance/expenses';
import { DeviceHint } from './device-hint';

export type PdfFieldError = { kind: 'photo' | 'notPdf' | 'tooLarge'; fileName: string } | { kind: 'server'; detail: string };

/**
 * Das PDF-Feld einer Belegposition (Designer-README 3a): ein großer Knopf
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

  return (
    <div className="space-y-2">
      {filed ? (
        <div data-testid="receipt-file" className="flex min-h-[var(--field-h)] items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2">
          <FileText className="size-5 shrink-0 text-muted-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] text-ink">{fileName ?? documentNumber}</p>
            <p className="text-[12px] text-muted-ink">
              {[fileSize !== null ? formatFileSize(fileSize) : null, documentNumber ? t('filed', { number: documentNumber }) : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <Button type="button" variant="ghost" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {t('replace')}
          </Button>
        </div>
      ) : (
        <Button id={`pdf-${positionKey}`} type="button" variant="outline" size="lg" className="w-full" disabled={uploading} onClick={() => inputRef.current?.click()}>
          <FileUp aria-hidden />
          {uploading ? t('uploading') : t('choose')}
        </Button>
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
        <div role="alert" className="rounded-md border border-error bg-error-bg p-2.5 text-[13px]">
          {error.kind === 'server' ? (
            <p className="text-ink">{error.detail}</p>
          ) : (
            <>
              <p className="font-semibold text-ink">{error.kind === 'tooLarge' ? t('tooLarge', { limit: formatFileSize(maxBytes) }) : t(error.kind)}</p>
              <p className="text-ink-2">{t('file', { name: error.fileName })}</p>
              <p className="text-ink-2">{t('keep')}</p>
            </>
          )}
        </div>
      ) : null}
      {filed ? null : <DeviceHint device={device} />}
    </div>
  );
}
