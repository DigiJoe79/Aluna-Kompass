'use client';

import { Menu, PanelLeft, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { initials } from './user-menu';

export function Topbar({ breadcrumb, title, userName, collapsed, drawer, onExpand, onOpenDrawer, onSearch }: { breadcrumb: string; title: string; userName: string; collapsed: boolean; drawer: boolean; onExpand: () => void; onOpenDrawer: () => void; onSearch: () => void }) {
  const t = useTranslations('shell.topbar');
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-line bg-topbar px-5">
      {drawer ? (
        <button type="button" onClick={onOpenDrawer} aria-label={t('openNav')} className="rounded-sm border border-line-strong p-1"><Menu className="size-4" /></button>
      ) : collapsed ? (
        <button type="button" onClick={onExpand} aria-label={t('expandNav')} className="rounded-sm border border-line-strong p-1"><PanelLeft className="size-4" /></button>
      ) : null}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[11px] text-muted-ink">{breadcrumb}</div>
        <h1 className="truncate font-heading text-[18px]">{title}</h1>
      </div>
      <button type="button" onClick={onSearch} className="flex h-8 w-60 items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-placeholder">
        <Search className="size-3.5" aria-hidden />
        <span className="flex-1 text-left">{t('search')}</span>
        <kbd className="rounded-[3px] border border-line px-1 font-mono text-[11px]">⌘K</kbd>
      </button>
      <span className="flex size-[30px] items-center justify-center rounded-full bg-brand text-[12px] font-bold text-on-brand" aria-hidden>{initials(userName)}</span>
    </header>
  );
}
