'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * Am Telefon steht kein Baum neben der Liste, sondern ein Ortsknopf darüber
 * (README § 3, Artboard 11): Weg klein, Name groß, Summe, Pfeil. Er öffnet den
 * Baum im Sheet von unten. Ein Name darin öffnet den Ordner und schließt das
 * Sheet; der Pfeil an der Zeile klappt nur auf.
 */
export function FolderSheet({
  path,
  title,
  count,
  place,
  className,
  children,
}: {
  /** Die Elternordner als Namen, von oben nach unten. */
  path: string[];
  title: string;
  count: number;
  /** Wechselt mit dem geöffneten Ort; ein neuer Ort schließt das Sheet. */
  place: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations('folderTree');
  const [open, setOpen] = useState(false);
  // Wer im Sheet einen Ort wählt, will dorthin, nicht zurück ins Sheet —
  // auch wenn die Wahl über die Tastatur kam und kein Link geklickt wurde.
  const [shownPlace, setShownPlace] = useState(place);
  if (shownPlace !== place) {
    setShownPlace(place);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        data-testid="folder-sheet-trigger"
        aria-haspopup="dialog"
        aria-description={t('pickTitle')}
        onClick={() => setOpen(true)}
        className={cn(
          'mb-3 flex min-h-[52px] w-full items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          className
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          {path.length > 0 ? <span className="truncate text-[12px] text-muted-ink">{path.join(' › ')}</span> : null}
          <strong className="text-[16px] font-semibold wrap-anywhere text-ink">{title}</strong>
        </span>
        <span data-testid="folder-sheet-count" className="font-mono text-[13px] text-muted-ink">
          {count}
        </span>
        <ChevronDown className="size-[18px] shrink-0 text-muted-ink" strokeWidth={2.2} aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-[16px] bg-surface pb-4 shadow-md">
          <div aria-hidden className="flex justify-center pt-2 pb-0.5">
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
          <SheetTitle className="flex h-[52px] items-center px-4 font-heading text-[17px] font-semibold text-ink">{t('label')}</SheetTitle>
          <div
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5"
            // Ein Name im Baum oder ein fester Eintrag ist ein Link: Wer ihn
            // antippt, hat gewählt — auch den Ort, der schon offen ist.
            onClickCapture={(e) => {
              if (e.target instanceof Element && e.target.closest('a[href]')) setOpen(false);
            }}
          >
            {children}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
