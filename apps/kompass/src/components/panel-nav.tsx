import Link from 'next/link';
import { PanelNavScroll } from '@/components/panel-nav-scroll';
import { cn } from '@/lib/utils';

/**
 * Unterbereiche einer Einstellungsseite (MUSTER.md § D). Der aktive Bereich
 * steht in der Adresse (`?panel=`), damit Lesezeichen, Zurück-Taste und Links
 * aus anderen Seiten (`panelHref`) genau dort landen. Ohne Hooks und ohne
 * Übersetzung, damit Server- und Client-Seiten ihn gleich benutzen.
 */
export function panelFromQuery<K extends string>(value: string | undefined, panels: readonly K[], fallback: K): K {
  return (panels as readonly string[]).includes(value ?? '') ? (value as K) : fallback;
}

/** Der einzige Weg zu einem `?panel=`-Link, auch von anderen Seiten aus. */
export function panelHref(basePath: string, panel: string): string {
  return `${basePath}?panel=${panel}`;
}

export function PanelNav<K extends string>({
  basePath,
  panels,
  active,
  labels,
  invalid,
  invalidLabel,
  ariaLabel,
}: {
  basePath: string;
  panels: readonly K[];
  active: K;
  labels: Record<K, string>;
  invalid?: ReadonlySet<K>;
  invalidLabel?: string;
  ariaLabel: string;
}) {
  return (
    // Unter 640 px waagrecht scrollbar statt umgebrochen: Zwei Zeilen Reiter lesen sich wie zwei Navigationen.
    <nav aria-label={ariaLabel} className="border-b border-line">
      <PanelNavScroll className="flex gap-5 overflow-x-auto max-sm:[scrollbar-width:none]">
        {panels.map((key) => {
          const isActive = key === active;
          const isInvalid = invalid?.has(key) ?? false;
          return (
            <Link
              key={key}
              href={panelHref(basePath, key)}
              aria-current={isActive ? 'page' : undefined}
              data-invalid={isInvalid ? 'true' : undefined}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap text-[14px]',
                isActive ? 'font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-primary)]' : 'text-ink-2 hover:text-ink',
              )}
            >
              {labels[key]}
              {isInvalid ? <span className="size-[7px] rounded-full bg-error" aria-label={invalidLabel} /> : null}
            </Link>
          );
        })}
      </PanelNavScroll>
    </nav>
  );
}
