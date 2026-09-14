'use client';

import type { HandbookChapter } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { activeRailKey, buildRail, crumbsFor, locate, sectionsFor, type NavGroup } from '@/lib/navigation';
import { CommandPalette } from './command-palette';
import { HelpPanel } from './help-panel';
import { Rail } from './rail';
import { SectionNav } from './section-nav';
import { Topbar } from './topbar';

export const DRAWER_BREAKPOINT = 1180;

export function ShellFrame({ organization, logoUrl, groups, build, user, permissions, helpChapters, helpPages, children }: { organization: string; logoUrl: string | null; groups: NavGroup[]; build: string; user: { name: string; roleNames: string[] }; permissions: string[]; helpChapters: HandbookChapter[]; helpPages: { doc: string; title: string; chapter: string }[]; children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const media = matchMedia(`(max-width: ${DRAWER_BREAKPOINT - 1}px)`);
    const sync = () => setDrawer(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // Eine Ortsbestimmung, vier Ableitungen — damit Schiene, Zweitebene und
  // Brotkrume nie verschiedener Meinung sind, auf welcher Seite wir stehen.
  const rail = useMemo(() => buildRail(groups), [groups]);
  const active = useMemo(() => activeRailKey(groups, pathname), [groups, pathname]);
  const sections = useMemo(() => sectionsFor(groups, pathname), [groups, pathname]);
  const activeHref = useMemo(() => locate(groups, pathname)?.item.href ?? null, [groups, pathname]);
  const crumbs = useMemo(() => crumbsFor(groups, pathname, t, helpChapters), [groups, pathname, t, helpChapters]);
  const openPalette = () => window.dispatchEvent(new CustomEvent('kompass:command-palette'));
  const closeDrawer = () => setDrawerOpen(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable]') || target.isContentEditable)) return;
      e.preventDefault();
      setHelpOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <CommandPalette groups={groups} permissions={permissions} helpPages={helpPages} />
      <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} pathname={pathname} />
      <div className="flex min-h-0 flex-1 flex-col">
        <Topbar organization={organization} logoUrl={logoUrl} crumbs={crumbs} user={user} build={build} drawer={drawer} onOpenDrawer={() => setDrawerOpen(true)} onSearch={openPalette} onHelp={() => setHelpOpen(true)} />
        <div className="flex min-h-0 flex-1">
          {drawer ? (
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetContent side="left" className="w-[280px] gap-0 overflow-y-auto p-0 pt-10 shadow-md">
                <SheetTitle className="sr-only">{t('nav.aria')}</SheetTitle>
                <Rail entries={rail} active={active} variant="list" onClose={closeDrawer} />
                <SectionNav sections={sections} activeHref={activeHref} variant="list" onClose={closeDrawer} />
              </SheetContent>
            </Sheet>
          ) : (
            <>
              <Rail entries={rail} active={active} variant="rail" />
              <SectionNav sections={sections} activeHref={activeHref} variant="column" />
            </>
          )}
          <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </>
  );
}
