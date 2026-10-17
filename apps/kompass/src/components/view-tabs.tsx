import Link from 'next/link';
import { PanelNavScroll } from '@/components/panel-nav-scroll';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';

/**
 * Reiter über einer Liste (Board § L Ziel 6, HANDOFF § 8e.1): Sicht wechseln, nicht filtern. Jeder Reiter ist
 * eine eigene Adresse, deshalb Links mit `aria-current="page"` und kein `role="tab"` (Pfeiltasten gäbe es nicht).
 * Unterstrich wie `PanelNav`, Zahl als `StatusBadge` (0 oder keine Zahl → keine Marke); unter 640 px scrollt die
 * Leiste waagerecht, statt umzubrechen. Die Zahlen folgen den Filtern der Leiste — das liefert der Aufrufer.
 *
 * `tone: 'agent'`: Zahl in `--color-agent` für Arbeit, die eine Maschine vorgelegt hat (Board Vorschläge 1d,
 * Designer 2026-10-10).
 */
export function ViewTabs({
  label,
  tabs,
  current,
}: {
  label: string;
  tabs: readonly { key: string; label: string; href: string; count?: number; tone?: 'neutral' | 'agent'; testId?: string }[];
  current: string;
}) {
  return (
    <nav aria-label={label} className="border-b border-line">
      {/*
        Telefon: Die Reihe läuft bis an den Bildschirmrand statt an der Inhaltskante zu enden — so ist der letzte
        sichtbare Reiter angeschnitten, und man erkennt, dass es weitergeht (Designer 2026-10-16, Teil 2 Nr. 14).
        Dazu ein Verlauf am Rand, auf dem es weitergeht (Runde 3, 064; Runde 4, Frage 5): Der angeschnittene Reiter läuft
        aus, statt hart zu enden; wenn alles passt, fällt er weg. Der aktive Reiter wird beim Öffnen ganz in den Blick
        gerollt. Beides macht `PanelNavScroll`, derselbe Streifen wie in der `PanelNav`.
        Kein Layout-Test: Einzelstelle, Laufzeit zählt (Projektregel).
      */}
      <PanelNavScroll className="flex gap-[22px] overflow-x-auto max-sm:-mr-(--shell-pad) max-sm:pr-(--shell-pad) max-sm:[scrollbar-width:none]">
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
                <StatusBadge tone={tab.tone ?? 'neutral'} className="px-1.5 py-0 tabular-nums">
                  {tab.count}
                </StatusBadge>
              ) : null}
            </Link>
          );
        })}
      </PanelNavScroll>
    </nav>
  );
}
