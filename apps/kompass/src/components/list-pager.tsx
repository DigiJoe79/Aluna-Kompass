import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Blättern unter einer begrenzten Liste (Board § L Ziel 4, HANDOFF § 8e.1): „{from}–{to} von {total}“, Zurück und
 * Weiter nur, wo es sie braucht, 50 je Seite wie das Protokoll. Passt alles auf eine Seite, steht nichts da. Der
 * Aufrufer baut die Adressen (`hrefFor`); ein Filterwechsel setzt die Seite dort zurück.
 */
export function ListPager({
  total,
  offset,
  pageSize = 50,
  hrefFor,
  footer = false,
  testId,
}: {
  total: number;
  offset: number;
  pageSize?: number;
  hrefFor: (offset: number) => string;
  /** Fuß der Tabellenkarte (Designer 2026-10-08): Linie oben, Polster wie die Karte. Ohne Karte steht er direkt unter der Tabelle. */
  footer?: boolean;
  testId?: string;
}) {
  const t = useTranslations('common.listPager');
  if (total <= pageSize && offset === 0) return null;
  const hasPrev = offset > 0;
  const hasNext = offset + pageSize < total;
  return (
    <nav aria-label={t('label')} data-testid={testId} className={cn('flex items-center gap-2.5 py-2.5 text-meta', footer && 'border-t border-line px-4')}>
      <span className="mr-auto text-muted-ink tabular-nums">
        {t('range', { from: Math.min(offset + 1, total), to: Math.min(offset + pageSize, total), total })}
      </span>
      {hasPrev ? (
        <Link href={hrefFor(Math.max(0, offset - pageSize))} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('prev')}
        </Link>
      ) : null}
      {hasNext ? (
        <Link href={hrefFor(offset + pageSize)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('next')}
        </Link>
      ) : null}
    </nav>
  );
}
