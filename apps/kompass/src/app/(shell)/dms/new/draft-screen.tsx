'use client';

import { useTranslations } from 'next-intl';
import { memo, useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { DraftForm, type DraftFormProps } from './draft-form';
import { DraftPreview, type PreviewStatus } from './draft-preview';

/**
 * Schreiben und Ergebnis nebeneinander: links das Formular, rechts das Blatt,
 * das daraus wird. Unter 1180 px ist für beides kein Platz — dort werden aus
 * den Spalten zwei Reiter, und der Reiter der Vorschau trägt einen Punkt,
 * solange sie veraltet ist.
 */
/**
 * Gemerkt, damit ein Neuzeichnen der Vorschau das Formular nicht anfasst:
 * React schreibt beim Zeichnen die Werte kontrollierter Felder in den DOM
 * zurück. Geschieht das im selben Tastendruck, in dem jemand tippt, verliert
 * React die Änderung — das erste getippte Zeichen war weg.
 */
const Form = memo(DraftForm);

export function DraftScreen({
  title,
  description,
  back,
  ...form
}: DraftFormProps & {
  title: string;
  description: string;
  back: { href: string; label: string };
}) {
  const t = useTranslations('dms');
  const [changed, setChanged] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(form.draft ? new Date(form.draft.savedAt) : null);
  const [version, setVersion] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<'form' | 'preview'>('form');
  const [sheet, setSheet] = useState<{ url: string; pages: number | null } | null>(null);

  const src = form.draft ? `/dms/${form.draft.id}/preview?v=${version}` : null;

  /**
   * Das Blatt wird hier geholt, nicht vom `<iframe>`: Nur so kommt die
   * Seitenzahl an, die im Kopf der Antwort steht — und das Rendern ist fertig,
   * wenn die Antwort da ist, statt wenn ein Zeitgeber abläuft.
   */
  useEffect(() => {
    if (!src) return;
    let current = true;
    let url: string | null = null;
    setRendering(true);

    fetch(src)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const pages = Number.parseInt(response.headers.get('x-pages') ?? '', 10);
        const blob = await response.blob();
        if (!current) return;
        url = URL.createObjectURL(blob);
        setSheet({ url, pages: Number.isNaN(pages) ? null : pages });
        setFailed(false);
      })
      .catch(() => {
        if (current) setFailed(true);
      })
      .finally(() => {
        if (current) setRendering(false);
      });

    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);
  const status: PreviewStatus = !form.draft
    ? 'none'
    : failed
      ? 'error'
      : rendering || !sheet
        ? 'rendering'
        : changed > 0
          ? 'stale'
          : 'current';

  // Stabil, damit die gemerkte Form nicht doch neu zeichnet.
  const saved = useCallback((at: Date) => {
    setSavedAt(at);
    setFailed(false);
    setVersion((v) => v + 1);
  }, []);

  const preview = (
    <DraftPreview
      status={status}
      src={sheet?.url ?? null}
      href={src}
      pages={sheet?.pages ?? null}
      savedAt={savedAt}
      onRetry={() => {
        setFailed(false);
        setVersion((v) => v + 1);
      }}
    />
  );

  return (
    // Die Höhe kommt aus dem Hauptbereich, nicht aus einer Rechnung gegen das
    // Fenster: Was über dem Bereich steht — Umgebungsbalken, Kopfzeile, was
    // später dazukommt —, geht die Seite hier nichts an. `+3rem` gleicht die
    // Polsterung des Bereichs aus, die das `-m-6` nach aussen schiebt.
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col overflow-hidden min-[1180px]:flex-row">
      {/* Links wird gescrollt, rechts bleibt das Blatt stehen. */}
      {/* Mitwachsend statt festgenagelt: Die 560 px des Entwurfs waren dort
          fast die halbe Breite und sind auf einem grossen Bildschirm ein
          Viertel — der Teil, in dem gearbeitet wird, schrumpfte mit jedem
          Zoll. Die Grenzen halten die Spalte lesbar. */}
      <div
        data-slot="form-column"
        className="flex min-h-0 min-w-0 flex-col overflow-y-auto border-line min-[1180px]:w-[clamp(520px,34%,760px)] min-[1180px]:shrink-0 min-[1180px]:border-r"
      >
        <div className="px-6 pt-6">
          <PageHeader title={title} description={description} back={back} />
        </div>

        {/* Unter 1180 px: zwei Reiter statt zwei Spalten. */}
        <div className="flex gap-1 border-b border-line px-6 min-[1180px]:hidden" role="tablist">
          {(['form', 'preview'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-ink-2',
                tab === key && 'border-brand text-ink'
              )}
            >
              {t(key === 'form' ? 'draft.tabForm' : 'preview')}
              {key === 'preview' && status === 'stale' ? (
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
              ) : null}
            </button>
          ))}
        </div>

        <div className={cn('min-w-0 flex-1', tab === 'preview' && 'hidden min-[1180px]:block')}>
          <Form {...form} onChangedCount={setChanged} onSaved={saved} />
        </div>
      </div>

      <div className={cn('flex min-h-0 min-w-0 flex-1', tab === 'form' && 'hidden min-[1180px]:flex')}>{preview}</div>
    </div>
  );
}
