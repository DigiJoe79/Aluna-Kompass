'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { NavSection } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export interface SectionNavProps {
  sections: NavSection[];
  /** `href` des Eintrags, auf dem die Seite liegt (`locate().item.href`). */
  activeHref: string | null;
  /** `column`: 208 px neben der Schiene. `list`: unter der Schiene im Drawer. */
  variant: 'column' | 'list';
  onClose?: () => void;
}

/**
 * Die Seiten des aktiven Bereichs. Kein Icon (die Symbole tragen die
 * Bereiche), kein Aufklappen, keine Zähler. Aktiv ist die Auswahl
 * (`bg-selected`), nicht die Marke — die trägt die Schiene.
 */
export function SectionNav({ sections, activeHref, variant, onClose }: SectionNavProps) {
  const t = useTranslations();
  if (sections.length === 0) return null;
  return (
    <nav
      aria-label={t('nav.sectionAria')}
      className={cn('flex shrink-0 flex-col gap-0.5 p-2', variant === 'column' && 'w-52 overflow-y-auto border-r border-line bg-bg')}
    >
      {sections.map((section, index) => (
        <div key={section.key} className={cn('flex flex-col gap-0.5', index > 0 && 'mt-3')}>
          {section.labelKey ? (
            <div className="flex h-7 items-center px-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-muted-ink">{t(section.labelKey)}</div>
          ) : null}
          {section.items.map((item) => {
            const isActive = item.href === activeHref;
            return (
              <div key={item.key} className="flex flex-col gap-0.5">
                {item.sectionBreak ? <div className="mx-2.5 my-1 h-px bg-line" aria-hidden /> : null}
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onClose?.()}
                  className={cn(
                    'flex h-8 items-center rounded-md px-2.5 text-[14px]',
                    isActive ? 'bg-selected font-semibold text-selected-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
                  )}
                >
                  <span className="truncate">{item.label ?? t(item.labelKey)}</span>
                </Link>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
