'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { NavGroup } from '@/lib/navigation';
import { usePreference } from '@/lib/preferences';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { CommandPalette } from './command-palette';

export const DRAWER_BREAKPOINT = 1180;

function titleFor(pathname: string, groups: NavGroup[], t: (k: string) => string): { title: string; group: string } {
  if (pathname === '/') return { title: t('nav.home'), group: '' };
  if (pathname.startsWith('/profile')) return { title: t('nav.profile'), group: '' };
  for (const group of groups) {
    const hit = group.items.find((i) => pathname.startsWith(i.href));
    if (hit) return { title: hit.label ?? t(hit.labelKey), group: t(group.labelKey) };
  }
  return { title: '', group: '' };
}

export function ShellFrame({ organization, logoUrl, groups, build, user, permissions, children }: { organization: string; logoUrl: string | null; groups: NavGroup[]; build: string; user: { name: string; roleNames: string[] }; permissions: string[]; children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = usePreference('sidebarCollapsed');
  const [collapsedGroups, setCollapsedGroups] = usePreference('navCollapsedGroups');
  const toggleGroup = (key: string) =>
    setCollapsedGroups(collapsedGroups.includes(key) ? collapsedGroups.filter((k) => k !== key) : [...collapsedGroups, key]);
  const [drawer, setDrawer] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const media = matchMedia(`(max-width: ${DRAWER_BREAKPOINT - 1}px)`);
    const sync = () => setDrawer(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '[' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) setCollapsed(!collapsed);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed, setCollapsed]);

  const { title, group } = titleFor(pathname, groups, t);
  const breadcrumb = [organization, group].filter(Boolean).join(' / ');
  const openPalette = () => window.dispatchEvent(new CustomEvent('kompass:command-palette'));

  return (
    <TooltipProvider>
      <CommandPalette groups={groups} permissions={permissions} />
      <div className="flex min-h-0 flex-1">
        {drawer ? (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" className="w-[280px] p-0 shadow-md">
              <SheetTitle className="sr-only">{t('nav.aria')}</SheetTitle>
              <Sidebar organization={organization} logoUrl={logoUrl} groups={groups} build={build} collapsed={false} onToggle={() => {}} onClose={() => setDrawerOpen(false)} user={user} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup} />
            </SheetContent>
          </Sheet>
        ) : (
          <Sidebar organization={organization} logoUrl={logoUrl} groups={groups} build={build} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} user={user} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup} />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar breadcrumb={breadcrumb} title={title} userName={user.name} collapsed={collapsed} drawer={drawer} onExpand={() => setCollapsed(false)} onOpenDrawer={() => setDrawerOpen(true)} onSearch={openPalette} />
          <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
