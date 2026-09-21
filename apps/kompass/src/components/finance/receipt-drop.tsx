'use client';

import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Ablagefläche für Belege (HANDOFF § 2.8, Baustein 9). Nimmt nur PDF — ein
 * Foto wird am Feld freundlich abgewiesen, die übrigen Eingaben bleiben
 * stehen. Kein Kamera-Knopf.
 */
export function ReceiptDrop({ onFiles, onPickFromArchive, disabled }: { onFiles: (files: File[]) => void; onPickFromArchive?: () => void; disabled?: boolean }) {
  const t = useTranslations('finance.receipt');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = (files: FileList | File[]): void => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const bad = list.find((f) => f.type !== 'application/pdf');
    if (bad) {
      setError(bad.type.startsWith('image/') ? t('photo') : t('wrongType'));
      return;
    }
    setError(null);
    onFiles(list);
  };

  return (
    <div className="space-y-1.5">
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
          'flex h-24 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-center text-[13px]',
          dragging ? 'border-primary bg-brand-soft' : 'border-line-strong bg-surface',
        )}
      >
        <FileUp className="size-5 text-muted-ink" aria-hidden />
        {dragging ? (
          <p className="font-semibold text-ink">{t('dropHere')}</p>
        ) : (
          <>
            <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="font-semibold text-ink underline underline-offset-2">
              {t('dragOrPick')}
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
          type="file"
          accept="application/pdf"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files) accept(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
