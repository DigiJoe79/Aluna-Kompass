'use client';

import { Upload } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Die Ablagefläche für die eingehende Post. Das eigentliche `<input type=file>`
 * bleibt im Formular stehen und wird nur vor die Augen geschoben: So geht die
 * Datei mit dem Formular auf die Reise, die Tastaturbedienung bleibt, und ein
 * Test kann sie setzen wie an jedem anderen Feld auch.
 */
export function FileDropzone({
  id,
  name,
  required,
  initial,
  onFile,
}: {
  id: string;
  name: string;
  required?: boolean;
  /** Eine Datei, die schon vor dem Öffnen des Formulars gezogen wurde. */
  initial?: File | null;
  onFile?: (file: File | null) => void;
}) {
  const t = useTranslations('dms');
  const format = useFormatter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(initial ?? null);
  const [over, setOver] = useState(false);

  // Was gezogen wurde, muss ins Feld: Abgeschickt wird, was dort steht.
  useEffect(() => {
    if (!initial || !input.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(initial);
    input.current.files = transfer.files;
  }, [initial]);

  const take = (next: File | null) => {
    setFile(next);
    onFile?.(next);
  };

  const size = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${format.number(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`
      : `${format.number(Math.max(1, Math.round(bytes / 1024)))} KB`;

  return (
    <>
      <input
        ref={input}
        id={id}
        name={name}
        type="file"
        accept="application/pdf"
        required={required}
        className="sr-only"
        onChange={(e) => take(e.target.files?.[0] ?? null)}
      />

      {file ? (
        <div className="flex items-center gap-3.5 rounded-md border border-line-strong bg-surface p-3">
          <FilePlaceholder />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
            <p className="font-mono text-[12px] text-muted-ink">{t('upload.meta', { size: size(file.size) })}</p>
            <p className="text-[12px] text-ink-2">{t('upload.ocrPending')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                // Die Datei liegt noch im Browser; der Server hat sie nie gesehen.
                const url = URL.createObjectURL(file);
                window.open(url, '_blank', 'noopener');
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              }}
            >
              {t('upload.view')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
              {t('upload.replace')}
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (!dropped || !input.current) return;
            // Der Umweg über das Feld ist der Punkt: abgeschickt wird, was dort
            // steht, nicht was React sich merkt.
            input.current.files = e.dataTransfer.files;
            take(dropped);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-line-strong bg-surface-2 px-5 py-6 text-center',
            over && 'border-brand bg-brand-soft'
          )}
        >
          <Upload className="size-6 text-muted-ink" strokeWidth={1.7} aria-hidden />
          <p className="text-sm font-semibold text-ink">{t('upload.dropTitle')}</p>
          <p className="text-[13px] text-ink-2">
            <button
              type="button"
              className="cursor-pointer underline underline-offset-2"
              onClick={() => input.current?.click()}
            >
              {t('upload.dropBrowse')}
            </button>
          </p>
          <p className="text-[12px] text-muted-ink">{t('fileHint')}</p>
        </div>
      )}
    </>
  );
}

/** Ein Blatt Papier als Strichschema — die erste Seite zu rendern kommt später. */
function FilePlaceholder() {
  return (
    <div
      aria-hidden
      className="flex h-[62px] w-[46px] shrink-0 flex-col justify-between rounded-[3px] border border-line bg-surface-2 px-[5px] py-1.5"
    >
      <div className="flex flex-col gap-1">
        <span className="block h-0.5 bg-line-strong" />
        <span className="block h-0.5 bg-line-strong" />
        <span className="block h-0.5 w-3/5 bg-line-strong" />
      </div>
      <span className="font-mono text-[8px] text-muted-ink">PDF</span>
    </div>
  );
}
