'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { NavSection } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Overline } from '@/components/overline';

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
            <Overline as="div" className="flex h-7 items-center px-2.5">{t(section.labelKey)}</Overline>
          ) : null}
          {section.items.map((item) => {
            const isActive = item.href === activeHref;
            return (
              <div key={item.key} className="flex flex-col gap-0.5">
                {item.sectionBreak ? <div className="mx-2.5 my-1 h-px bg-line" aria-hidden /> : null}
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  // N1 (Freigabe Joe 2026-10-24): „später“ ist ein normaler Link, gedämpft, mit Zusatz rechts.
                  aria-label={item.later ? t('nav.laterLabel', { name: item.label ?? t(item.labelKey) }) : undefined}
                  onClick={() => onClose?.()}
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-md px-2.5 text-body',
                    isActive ? 'bg-selected font-semibold text-selected-ink' : item.later ? 'text-muted-ink hover:bg-hover' : 'text-ink-2 hover:bg-hover hover:text-ink',
                  )}
                >
                  <span className="truncate">{item.label ?? t(item.labelKey)}</span>
                  {item.later ? <span className="ml-auto shrink-0 text-hint">{t('nav.later')}</span> : null}
                </Link>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
