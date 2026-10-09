import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';

/**
 * Reiter über einer Liste (Board § L Ziel 6, HANDOFF § 8e.1): Sicht wechseln, nicht filtern. Jeder Reiter ist
 * eine eigene Adresse, deshalb Links mit `aria-current="page"` und kein `role="tab"` (Pfeiltasten gäbe es nicht).
 * Unterstrich wie `PanelNav`, Zahl als `StatusBadge` (0 oder keine Zahl → keine Marke); unter 640 px scrollt die
 * Leiste waagerecht, statt umzubrechen. Die Zahlen folgen den Filtern der Leiste — das liefert der Aufrufer.
 */
export function ViewTabs({
  label,
  tabs,
  current,
}: {
  label: string;
  tabs: readonly { key: string; label: string; href: string; count?: number; testId?: string }[];
  current: string;
}) {
  return (
    <nav aria-label={label} className="border-b border-line">
      <div className="flex gap-[22px] overflow-x-auto max-sm:[scrollbar-width:none]">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              data-testid={tab.testId}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-10 shrink-0 items-center gap-[7px] whitespace-nowrap text-body',
                active ? 'font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-primary)]' : 'text-ink-2 hover:text-ink',
              )}
            >
              {tab.label}
              {tab.count ? ' ' : null}
              {tab.count ? (
                <StatusBadge tone="neutral" className="px-1.5 py-0 font-medium tabular-nums">
                  {tab.count}
                </StatusBadge>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
