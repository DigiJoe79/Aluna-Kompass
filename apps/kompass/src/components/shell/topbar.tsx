'use client';

import { CircleQuestionMark, Menu, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { UserMenu, type UserMenuProps } from './user-menu';

export interface TopbarProps {
  organization: string;
  logoUrl: string | null;
  /** Brotkrume; das letzte Segment ist das `<h1>` der Seite. */
  crumbs: string[];
  user: UserMenuProps['user'];
  build: string;
  version: string;
  drawer: boolean;
  onOpenDrawer: () => void;
  onSearch: () => void;
  onHelp: () => void;
}

/**
 * Läuft über die volle Breite und trägt, was die Sidebar abgegeben hat: Logo,
 * Vereinsname, Nutzermenü. Der Menüknopf erscheint nur im Drawer-Modus — im
 * festen Rahmen gibt es nichts zu klappen.
 */
export function Topbar({ organization, logoUrl, crumbs, user, build, version, drawer, onOpenDrawer, onSearch, onHelp }: TopbarProps) {
  const t = useTranslations();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line bg-topbar px-4">
      {drawer ? (
        <button type="button" onClick={onOpenDrawer} aria-label={t('shell.topbar.openNav')} className="flex size-[30px] shrink-0 items-center justify-center rounded-sm hover:bg-hover">
          <Menu className="size-4" />
        </button>
      ) : null}
      <div className="flex h-[30px] shrink-0 items-center gap-2.5 border-r border-line pr-3.5">
        {logoUrl ? (
          <img src={logoUrl} alt={t('nav.logoAlt')} className="size-[26px] shrink-0 rounded-sm object-contain" />
        ) : (
          <div className="flex size-[26px] shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-[9px] text-muted-ink-2" aria-hidden>LOGO</div>
        )}
        <span className="max-w-60 truncate text-[14px] font-semibold">{organization}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px]">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${index}-${crumb}`}>
              {index > 0 ? <span className="text-muted-ink-2" aria-hidden>/</span> : null}
              {last ? <h1 className="min-w-0 truncate text-[14px] font-semibold">{crumb}</h1> : <span className="min-w-0 truncate text-muted-ink">{crumb}</span>}
            </Fragment>
          );
        })}
      </div>
      <button type="button" onClick={onSearch} className="flex h-8 w-60 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-placeholder">
        <Search className="size-3.5" aria-hidden />
        <span className="flex-1 text-left">{t('shell.topbar.search')}</span>
        <kbd className="rounded-[3px] border border-line px-1 font-mono text-[11px]">⌘K</kbd>
      </button>
      <button type="button" onClick={onHelp} aria-label={t('shell.topbar.help')} className="flex size-[30px] shrink-0 items-center justify-center rounded-sm text-muted-ink hover:bg-hover hover:text-ink">
        <CircleQuestionMark className="size-[18px]" aria-hidden />
      </button>
      <UserMenu user={user} build={build} version={version} />
    </header>
  );
}
