import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface BeforeAfterRow {
  label: string;
  before: ReactNode;
  after: ReactNode;
}

/**
 * Dreispalter Vorher · Pfeil · Nachher (HANDOFF § 2.10, Baustein 11). Vorher
 * auf gedämpfter Fläche ohne eigene Rahmenfarbe, Nachher das aktive Feld.
 *
 * `layout="cards"` (HANDOFF § 12.1, Baustein 12 — Dubletten-Gegenüberstellung,
 * F4 Task 7): **keine eigene Komponente**, dasselbe Muster, nur zwei Karten
 * nebeneinander statt zwei Felder in einer Zeile — „Im Auszug“ mit stärkerem
 * Rand, die andere Seite gedämpft.
 */
export function BeforeAfter({
  layout = 'fields',
  rows,
  columnLabels,
}: {
  layout?: 'fields' | 'cards';
  rows: BeforeAfterRow[];
  /** Nur `layout="cards"`: eigene Spaltenüberschriften statt „Vorher“/„Nachher“ (etwa „Im Auszug“/„Bereits vorhanden“). */
  columnLabels?: { before: string; after: string };
}) {
  const t = useTranslations('common.beforeAfter');

  if (layout === 'cards') {
    const beforeLabel = columnLabels?.before ?? t('before');
    const afterLabel = columnLabels?.after ?? t('after');
    return (
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={index} className="space-y-1.5">
            {row.label ? <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-ink">{row.label}</p> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-ink">{beforeLabel}</p>
                <div className="rounded-md border-2 border-ink-2 bg-surface p-3 text-[13px]">{row.before}</div>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-ink">{afterLabel}</p>
                <div className="rounded-md border border-line bg-surface-2 p-3 text-[13px] text-ink-2">{row.after}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className="grid grid-cols-[minmax(120px,1fr)_2fr_28px_2fr] items-center gap-x-3 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-ink">
        <span />
        <span>{t('before')}</span>
        <span aria-hidden />
        <span>{t('after')}</span>
      </div>
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(120px,1fr)_2fr_28px_2fr] items-center gap-x-3 border-t border-line px-3 py-2">
          <span className="text-[13px] text-ink-2">{row.label}</span>
          <div className="rounded-sm bg-disabled px-2 py-1 text-[13px] text-muted-ink">{row.before}</div>
          <ArrowRight className="size-4 shrink-0 text-muted-ink" aria-hidden />
          <div className="text-[13px]">{row.after}</div>
        </div>
      ))}
    </div>
  );
}
