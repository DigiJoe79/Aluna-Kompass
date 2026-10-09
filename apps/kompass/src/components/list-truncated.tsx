import { cn } from '@/lib/utils';

/**
 * Der Satz unter einer gekürzten Liste, wo nicht geblättert werden kann (Ordnerbaum, Raster; Board § L Ziel 4):
 * „Es werden die ersten 200 von 312 … gezeigt.“ Den fertigen Satz liefert der Aufrufer, weil Nomen und Ausweg je
 * Liste andere sind. Bei vollständiger Liste nichts.
 */
export function ListTruncated({ shown, total, text, footer = false, testId, className }: { shown: number; total: number; text: string; /** Fuß der Tabellenkarte wie `ListPager footer`. */ footer?: boolean; testId?: string; className?: string }) {
  if (shown >= total) return null;
  return (
    <p data-testid={testId} className={cn('text-meta text-muted-ink', footer && 'border-t border-line px-4 py-2.5', className)}>
      {text}
    </p>
  );
}
