import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Overline } from '@/components/overline';

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
            {row.label ? <Overline>{row.label}</Overline> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Overline className="mb-1">{beforeLabel}</Overline>
                <div className="rounded-md border-2 border-ink-2 bg-surface p-3 text-meta">{row.before}</div>
              </div>
              <div>
                <Overline className="mb-1">{afterLabel}</Overline>
                <div className="rounded-md border border-line bg-surface-2 p-3 text-meta text-ink-2">{row.after}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line">
      {/* Fläche und Polster am Rahmen, die Overline bleibt reine Schrift (Designer 2026-10-10 § 10.7). */}
      <div className="bg-surface-2 px-3 py-1.5">
        {/* 14 B12: Am Telefon steht die Beschriftung über Vorher → Nachher (drei Spalten statt vier). */}
        <Overline as="div" className="grid grid-cols-[1fr_28px_1fr] items-center gap-x-3 sm:grid-cols-[minmax(120px,1fr)_2fr_28px_2fr]">
          <span className="max-sm:hidden" />
          <span>{t('before')}</span>
          <span aria-hidden />
          <span>{t('after')}</span>
        </Overline>
      </div>
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_28px_1fr] items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 sm:grid-cols-[minmax(120px,1fr)_2fr_28px_2fr]">
          <span className="text-meta text-ink-2 max-sm:col-span-3">{row.label}</span>
          {/* 14 B12: Vorher ist Text in Grau, kein graues Feld — das sah gesperrt aus. */}
          <div className="text-meta text-muted-ink">{row.before}</div>
          <ArrowRight className="size-4 shrink-0 text-muted-ink" aria-hidden />
          <div className="text-meta">{row.after}</div>
        </div>
      ))}
    </div>
  );
}
