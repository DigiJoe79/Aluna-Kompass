'use client';

import { ChevronDown, ChevronUp, Clock, Contact, Database, Droplet, Euro, FileText, Folder, Grid2x2, Home, Hourglass, Image, LayoutTemplate, Languages, List, PanelLeft, PawPrint, Shield, SlidersHorizontal, Upload, Users, X, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NavGroup } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { UserMenu, type UserMenuProps } from './user-menu';

const ICONS: Record<string, LucideIcon> = {
  users: Users,
  shield: Shield,
  sliders: SlidersHorizontal,
  languages: Languages,
  droplet: Droplet,
  grid: Grid2x2,
  clock: Clock,
  'file-text': FileText,
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
};

export interface SidebarProps {
  organization: string;
  logoUrl: string | null;
  groups: NavGroup[];
  build: string;
  collapsed: boolean;
  onToggle: () => void;
  onClose?: () => void;
  user: UserMenuProps['user'];
  /** Gruppen-Keys, deren Einträge eingeklappt sind (nur im ausgeklappten Zustand). */
  collapsedGroups: string[];
  onToggleGroup: (key: string) => void;
}

export function Sidebar({ organization, logoUrl, groups, build, collapsed, onToggle, onClose, user, collapsedGroups, onToggleGroup }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const width = collapsed ? 56 : 248;

  const item = (key: string, href: string, icon: string, label: string, disabled: boolean, group?: string) => {
    const Icon = ICONS[icon] ?? Home;
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    const link = (
      <Link
        key={key}
        href={disabled ? '#' : href}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => { if (disabled) e.preventDefault(); onClose?.(); }}
        className={cn(
          'flex items-center gap-2.5 rounded-md text-[14px]',
          collapsed ? 'mx-auto h-[34px] w-9 justify-center' : 'h-[34px] px-2.5',
          disabled ? 'cursor-default text-disabled-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
          active && 'bg-brand-soft font-semibold text-brand-ink shadow-[inset_2px_0_0_var(--color-primary)]',
        )}
      >
        <Icon className={cn('shrink-0', collapsed ? 'size-[17px]' : 'size-4', active ? 'text-brand-ink' : disabled ? 'text-disabled-ink' : 'text-muted-ink')} aria-hidden />
        {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
      </Link>
    );
    if (!collapsed) return link;
    return (
      <Tooltip key={key}>
        <TooltipTrigger render={link} />
        <TooltipContent side="right" className="bg-tooltip text-tooltip-ink shadow-md">
          <span className="text-[13px] font-semibold">{label}</span>
          {group ? <span className="ml-2 text-[11px] opacity-70">{group}</span> : null}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <nav aria-label={t('nav.aria')} style={{ width }} className="flex h-full shrink-0 flex-col border-r border-line bg-sidebar transition-[width]">
      <div className={cn('flex h-14 items-center border-b border-line', collapsed ? 'justify-center' : 'gap-2.5 pl-4 pr-3')}>
        {logoUrl ? <img src={logoUrl} alt={t('nav.logoAlt')} className="size-7 shrink-0 rounded-sm object-contain" /> : <div className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-[9px] text-muted-ink-2" aria-hidden>LOGO</div>}
        {collapsed ? null : (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[14px] font-semibold">{organization}</div>
            <div className="text-[11px] text-muted-ink">{t('app.name')}</div>
          </div>
        )}
        {onClose ? (
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-sm p-1 hover:bg-hover"><X className="size-4" /></button>
        ) : collapsed ? null : (
          <button type="button" onClick={onToggle} aria-label={t('nav.collapse')} className="rounded-sm p-1 hover:bg-hover"><PanelLeft className="size-4" /></button>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {item('home', '/', 'home', t('nav.home'), false)}
        {groups.map((group) => {
          const groupCollapsed = !collapsed && collapsedGroups.includes(group.key);
          return (
            <div key={group.key} className="flex flex-col gap-0.5">
              {collapsed ? (
                <div className="mx-auto my-1.5 h-px w-6 bg-line-strong" aria-hidden />
              ) : (
                <button
                  type="button"
                  onClick={() => onToggleGroup(group.key)}
                  aria-expanded={!groupCollapsed}
                  className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-3.5 text-[11px] font-bold uppercase tracking-[.09em] text-muted-ink hover:text-ink-2"
                >
                  <ChevronDown className={cn('size-3 shrink-0 transition-transform', groupCollapsed && '-rotate-90')} aria-hidden />
                  {t(group.labelKey)}
                </button>
              )}
              {groupCollapsed
                ? null
                : group.items
                    .filter((i) => i.visible)
                    .map((i) => (
                      <div key={i.key} className="flex flex-col gap-0.5">
                        {i.sectionBreak && !collapsed ? <div className="mx-2.5 my-1 h-px bg-line" aria-hidden /> : null}
                        {item(i.key, i.href, i.icon, i.label ?? t(i.labelKey), i.disabled, t(group.labelKey))}
                      </div>
                    ))}
            </div>
          );
        })}
      </div>
      <div className="border-t border-line p-2">
        <UserMenu user={user} collapsed={collapsed} trigger={<ChevronUp className="size-3.5" aria-hidden />} />
        {collapsed ? null : (
          <p className="px-2 pt-1.5 text-[10px] text-muted-ink" title={t('app.name')}>
            {t('shell.build', { id: build })}
          </p>
        )}
      </div>
    </nav>
  );
}
