'use client';

import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Die ersten Bytes von PNG, JPEG und PDF — für die Ablehnungsmeldung bei
 * `kind="image"` clientseitig nachgebaut (Annahme 5). Die eigentliche Prüfung
 * bleibt `documentImageExtension` im Dienst (`@kompass/core/documents/images`);
 * ein Import von dort brächte den Server-Auth-Code mit in dieses
 * Client-Bündel.
 */
function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return true;
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && [0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => bytes[i] === b);
}

/**
 * Ablagefläche für Belege (HANDOFF § 2.8, Baustein 9) und, mit `kind="image"`
 * (C3-6), für das Bild einer Unterschrift: kleinere Fläche (240 × 64 px),
 * Vorschau auf `--color-paper` (die Unterschrift ist schwarz auf weiß, auch
 * im dunklen Thema), „ersetzen“ statt eines zweiten Feldes. Beide Varianten
 * lehnen am Feld ab, nie über den Server allein — `kind="pdf"` nach dem
 * Browsertyp, `kind="image"` nach den ersten Bytes (die Prüfung selbst bleibt
 * im Dienst; hier entsteht nur die Meldung). `maxBytes` ist die Grenze des
 * Aufrufers (z. B. `FACSIMILE_MAX_BYTES`), keine Vorgabe des Bausteins.
 */
export function ReceiptDrop({
  onFiles,
  onPickFromArchive,
  disabled,
  kind = 'pdf',
  maxBytes,
  previewSrc,
  previewAlt,
}: {
  onFiles: (files: File[]) => void;
  onPickFromArchive?: () => void;
  disabled?: boolean;
  kind?: 'pdf' | 'image';
  maxBytes?: number;
  /** Nur `kind="image"`: liegt schon ein Bild vor, zeigt die Fläche die Vorschau statt der Ablage — mit „ersetzen“. */
  previewSrc?: string | null;
  previewAlt?: string;
}) {
  const t = useTranslations('finance.receipt');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptPdf = (list: File[]): void => {
    const bad = list.find((f) => f.type !== 'application/pdf');
    if (bad) {
      setError(bad.type.startsWith('image/') ? t('photo') : t('wrongType'));
      return;
    }
    const tooLarge = maxBytes ? list.find((f) => f.size > maxBytes) : undefined;
    if (tooLarge) {
      setError(t('tooLarge', { mb: Math.round((maxBytes! / (1024 * 1024)) * 10) / 10 }));
      return;
    }
    setError(null);
    onFiles(list);
  };

  const acceptImage = async (list: File[]): Promise<void> => {
    const file = list[0]!;
    if (maxBytes && file.size > maxBytes) {
      setError(t('tooLarge', { mb: Math.round((maxBytes / (1024 * 1024)) * 10) / 10 }));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeImage(bytes)) {
      setError(looksLikePdf(bytes) ? t('isPdf') : t('wrongTypeImage'));
      return;
    }
    setError(null);
    setReplacing(false);
    onFiles(list);
  };

  const accept = (files: FileList | File[]): void => {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (kind === 'image') void acceptImage(list);
    else acceptPdf(list);
  };

  const showPreview = kind === 'image' && !!previewSrc && !replacing;

  return (
    <div className="space-y-1.5">
      {showPreview ? (
        <div className="flex h-16 w-[240px] items-center justify-between gap-2 rounded-md border border-line bg-paper p-1.5">
          {/* Kein next/image: Die Bytes kommen nur über den Faksimile-Handler des Dienstes, nie zwischengespeichert. */}
          <img src={previewSrc} alt={previewAlt ?? ''} className="h-full max-w-[160px] object-contain" />
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setReplacing(true)}>
            {t('replace')}
          </Button>
        </div>
      ) : (
        <div
          role="presentation"
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!disabled) accept(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-center text-[13px]',
            kind === 'image' ? 'h-16 w-[240px]' : 'h-24',
            dragging ? 'border-primary bg-brand-soft' : 'border-line-strong bg-surface',
          )}
        >
          <FileUp className="size-5 text-muted-ink" aria-hidden />
          {dragging ? (
            <p className="font-semibold text-ink">{t('dropHere')}</p>
          ) : (
            <>
              <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="font-semibold text-ink underline underline-offset-2">
                {kind === 'image' ? t('dragOrPickImage') : t('dragOrPick')}
              </button>
              {onPickFromArchive ? (
                <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onPickFromArchive}>
                  {t('pickFromArchive')}
                </Button>
              ) : null}
            </>
          )}
          <input
            ref={inputRef}
            data-testid="voucher-file-input"
            type="file"
            accept={kind === 'image' ? 'image/png,image/jpeg' : 'application/pdf'}
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              if (e.target.files) accept(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {error ? (
        <p role="alert" className="text-[12px] text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
