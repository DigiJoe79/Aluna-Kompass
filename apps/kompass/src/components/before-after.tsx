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
 * `layout="cards"` (Dubletten-Gegenüberstellung) kommt mit F4 — dieselbe
 * Komponente, noch ohne diese Variante.
 */
export function BeforeAfter({ layout = 'fields', rows }: { layout?: 'fields'; rows: BeforeAfterRow[] }) {
  void layout;
  const t = useTranslations('common.beforeAfter');
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
