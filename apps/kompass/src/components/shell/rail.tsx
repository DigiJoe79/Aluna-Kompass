'use client';

import { Clock, Contact, Database, Droplet, Euro, File, FileText, Folder, Globe, Grid2x2, Home, Hourglass, Image, LayoutTemplate, Languages, List, PawPrint, Settings, Shield, SlidersHorizontal, Upload, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { RailEntry } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Die Whitelist der Symbole. Ein Manifest nennt einen Key von hier
 * (`NavigationItem.icon`, `ModuleManifest.moduleIcon`); ein unbekannter Key
 * fällt auf `Home` zurück, statt die Schale zu brechen.
 */
export const ICONS: Record<string, LucideIcon> = {
  users: Users,
  shield: Shield,
  sliders: SlidersHorizontal,
  languages: Languages,
  droplet: Droplet,
  grid: Grid2x2,
  clock: Clock,
  'file-text': FileText,
  file: File,
  image: Image,
  database: Database,
  euro: Euro,
  home: Home,
  folder: Folder,
  'paw-print': PawPrint,
  'layout-template': LayoutTemplate,
  upload: Upload,
  list: List,
  contact: Contact,
  hourglass: Hourglass,
  globe: Globe,
  settings: Settings,
};

export interface RailProps {
  entries: RailEntry[];
  /** Key des markierten Eintrags (`activeRailKey`). */
  active: string | null;
  /** `rail`: 88 px fest, Wort unter dem Icon. `list`: Zeilen im Drawer. */
  variant: 'rail' | 'list';
  onClose?: () => void;
}

/**
 * Eine Zeile je Bereich. Die Schiene trägt die Marke (Streifen links); die
 * Zweitebene trägt die Auswahl. Vor „Einstellungen“ eine Linie und `mt-auto`,
 * damit der Bereich unten steht, egal wie viele Module es gibt.
 */
export function Rail({ entries, active, variant, onClose }: RailProps) {
  const t = useTranslations();
  const rail = variant === 'rail';
  return (
    <nav
      aria-label={t('nav.aria')}
      className={cn('flex shrink-0 flex-col gap-0.5 overflow-y-auto py-2', rail ? 'w-[88px] border-r border-line bg-sidebar' : 'px-2')}
    >
      {entries.map((entry) => {
        const Icon = ICONS[entry.icon] ?? Home;
        const isActive = entry.key === active;
        const isSettings = entry.key === 'settings';
        return (
          <div key={entry.key} className={cn('flex flex-col gap-0.5', isSettings && rail && 'mt-auto')}>
            {isSettings ? <div className={cn('my-1 h-px bg-line', rail ? 'mx-auto w-10' : 'mx-2.5')} aria-hidden /> : null}
            <Link
              href={entry.href}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onClose?.()}
              className={cn(
                'flex items-center rounded-md',
                rail ? 'mx-auto h-[52px] w-[76px] flex-col justify-center gap-1' : 'h-[34px] gap-2.5 px-2.5',
                isActive ? 'bg-brand-soft font-semibold text-brand-ink shadow-[inset_2px_0_0_var(--color-primary)]' : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
            >
              <Icon className={cn('shrink-0', rail ? 'size-5' : 'size-4', isActive ? 'text-brand-ink' : 'text-muted-ink')} aria-hidden />
              <span className={cn('truncate', rail ? 'max-w-full px-1 text-[11px] leading-none' : 'text-[14px]')}>{t(entry.labelKey)}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
