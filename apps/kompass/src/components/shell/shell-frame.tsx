'use client';

import type { HandbookChapter } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { activeRailKey, buildRail, crumbsFor, locate, sectionsFor, type NavGroup } from '@/lib/navigation';
import { CommandPalette } from './command-palette';
import { HelpAsideContext, HelpPanel } from './help-panel';
import { Rail } from './rail';
import { SectionNav } from './section-nav';
import { Topbar } from './topbar';

export const DRAWER_BREAKPOINT = 1180;

// Ab `lg` steht die Hilfe als Nebenspalte neben der Seite, darunter als Blatt (Entwurf E4).
const HELP_ASIDE_QUERY = '(min-width: 1024px)';
const HELP_STORE = 'kompass.help.open';
const subscribeWide = (onChange: () => void) => {
  const media = matchMedia(HELP_ASIDE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const readStored = (): boolean => {
  try {
    return sessionStorage.getItem(HELP_STORE) === '1';
  } catch {
    return false;
  }
};
const writeStored = (open: boolean) => {
  try {
    sessionStorage.setItem(HELP_STORE, open ? '1' : '0');
  } catch {
    // Ohne Speicher (privates Fenster) merkt sich die Sitzung nichts — die Hilfe geht trotzdem auf und zu.
  }
};

export function ShellFrame({ organization, logoUrl, groups, build, version, user, permissions, helpChapters, helpPages, extras, children }: { organization: string; logoUrl: string | null; groups: NavGroup[]; build: string; version: string; user: { name: string }; permissions: string[]; helpChapters: HandbookChapter[]; helpPages: { doc: string; title: string; chapter: string }[]; extras?: ReactNode; children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const wide = useSyncExternalStore(subscribeWide, () => matchMedia(HELP_ASIDE_QUERY).matches, () => false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const restored = useRef(false);

  // Offen oder zu gilt je Sitzung (sessionStorage) — wiederhergestellt nur als Nebenspalte, nie als modales Blatt.
  useEffect(() => {
    if (restored.current) return;
    // Bei der Hydration liefert der Store noch den Serverwert (schmal): erst wiederherstellen, wenn er die echte Breite
    // kennt — sonst blitzte das modale Blatt auf.
    if (wide) {
      restored.current = true;
      if (readStored()) setHelpOpen(true);
    } else if (!matchMedia(HELP_ASIDE_QUERY).matches) restored.current = true;
  }, [wide]);
  useEffect(() => {
    if (restored.current) writeStored(helpOpen);
  }, [helpOpen]);
  // Unter `lg` geschoben: Die Nebenspalte schließt, statt ungefragt eine Fokusfalle zu werden (Vorschlag des Designers).
  const wasWide = useRef(wide);
  useEffect(() => {
    if (wasWide.current && !wide) setHelpOpen(false);
    wasWide.current = wide;
  }, [wide]);
  // Das Blatt schließt beim Seitenwechsel; die Nebenspalte bleibt offen und folgt der Seite.
  useEffect(() => {
    if (!matchMedia(HELP_ASIDE_QUERY).matches) setHelpOpen(false);
  }, [pathname]);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    helpButton.current?.focus();
  }, []);
  const toggleHelp = useCallback(() => {
    setHelpOpen((open) => {
      if (open) helpButton.current?.focus();
      return !open;
    });
  }, []);

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
      toggleHelp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleHelp]);
  const aside = wide && helpOpen;

  return (
    <>
      <CommandPalette groups={groups} permissions={permissions} helpPages={helpPages} />
      <HelpPanel mode="sheet" open={!wide && helpOpen} onClose={closeHelp} pathname={pathname} />
      <div className="flex min-h-0 flex-1 flex-col">
        <Topbar organization={organization} logoUrl={logoUrl} crumbs={crumbs} user={user} build={build} version={version} drawer={drawer} onOpenDrawer={() => setDrawerOpen(true)} onSearch={openPalette} onHelp={toggleHelp} helpOpen={helpOpen} helpAside={aside} helpButtonRef={helpButton} extras={extras} />
        <div className="flex min-h-0 flex-1">
          {drawer ? (
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetContent side="left" size="sm" className="gap-0 overflow-y-auto shadow-md">
                {/* Das Polster im inneren Behälter wie bei jedem Seitenfenster; die Listen bringen ihre Zeilenränder selbst mit, oben Platz für das Schließen. */}
                <div className="pt-10">
                  <SheetTitle className="sr-only">{t('nav.aria')}</SheetTitle>
                  <Rail entries={rail} active={active} variant="list" onClose={closeDrawer} />
                  <SectionNav sections={sections} activeHref={activeHref} variant="list" onClose={closeDrawer} />
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <>
              <Rail entries={rail} active={active} variant="rail" />
              <SectionNav sections={sections} activeHref={activeHref} variant="column" />
            </>
          )}
          {/* `--shell-pad`: Das Polster des Arbeitsbereichs; randlose Flächen (Ordnerspalte, `FolderColumn`) rechnen damit. */}
          <main className="min-h-0 flex-1 overflow-auto p-(--shell-pad) [--shell-pad:--spacing(6)]">
            <HelpAsideContext.Provider value={aside}>{children}</HelpAsideContext.Provider>
          </main>
          {/* Nach `main` im DOM: Tab-Reihenfolge Kopfleiste → Inhalt → Hilfe (Notiz „Öffnen, Schließen, Fokus“). */}
          <HelpPanel mode="aside" open={aside} onClose={closeHelp} pathname={pathname} />
        </div>
      </div>
    </>
  );
}
