'use client';

import { CircleQuestionMark, Menu, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode, Ref } from 'react';
import type { Crumb } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { UserMenu, type UserMenuProps } from './user-menu';

export interface TopbarProps {
  organization: string;
  logoUrl: string | null;
  /** Brotkrume (`crumbsFor`); endet bei der Liste. */
  crumbs: Crumb[];
  user: UserMenuProps['user'];
  build: string;
  version: string;
  drawer: boolean;
  onOpenDrawer: () => void;
  onSearch: () => void;
  onHelp: () => void;
  /** Hilfe offen: Knopf mit `aria-expanded`, als Nebenspalte zusätzlich `aria-controls` (Entwurf E4). */
  helpOpen?: boolean;
  helpAside?: boolean;
  helpButtonRef?: Ref<HTMLButtonElement>;
  /** Platz vor dem Hilfe-Knopf, den die Hülle nicht kennt — etwa die Laufanzeige eines Moduls. */
  extras?: ReactNode;
}

/**
 * Läuft über die volle Breite und trägt, was die Sidebar abgegeben hat: Logo,
 * Vereinsname, Nutzermenü. Der Menüknopf erscheint nur im Drawer-Modus — im
 * festen Rahmen gibt es nichts zu klappen.
 *
 * Telefon (`max-sm`, unter 640 px): Vereinsname, vordere Brotkrumen, Suchtext und
 * Tastenkürzel fallen weg (der Suchtext bleibt für Vorleser, `sr-only`; ein
 * `aria-label` machte `getByLabel('Suchen')` der Suchfelder mehrdeutig), das Nutzermenü zeigt nur die Initialen. Sonst schob das
 * 240 px breite Suchfeld Hilfe und Nutzermenü bei 390 px aus dem Bild, und von der
 * Brotkrume blieb nur „/“ (release-0.2.7.md, Befund 15). Das letzte Segment
 * bleibt sichtbar; das `h1` der Seite steht im `PageHeader`. Das letzte Segment trägt `font-heading` in der Rolle
 * Abschnitt (15/600), die übrigen Sans `text-meta` (Spec Seitenkopf § 2.1; K10 Charge 3, Designer § 11 — `topbar` ist
 * damit einer der acht Bausteine mit `font-heading`). Kein Layout-Test für diese Einzelstelle (AGENTS.md); der Überlauf-Wächter
 * der Screenshot-Pipeline prüft die Kopfzeile.
 */
export function Topbar({ organization, logoUrl, crumbs, user, build, version, drawer, onOpenDrawer, onSearch, onHelp, helpOpen = false, helpAside = false, helpButtonRef, extras }: TopbarProps) {
  const t = useTranslations();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line bg-topbar px-4">
      {drawer ? (
        <button type="button" onClick={onOpenDrawer} aria-label={t('shell.topbar.openNav')} className="flex size-[30px] shrink-0 items-center justify-center rounded-sm hover:bg-hover">
          <Menu className="size-4" />
        </button>
      ) : null}
      {/* Der Trennstrich nur, wenn eine Brotkrume folgt — sonst stünde er ins Leere (01 B16). */}
      <div className={cn('flex h-[30px] shrink-0 items-center gap-2.5', crumbs.length > 0 && 'border-r border-line pr-3.5')}>
        {logoUrl ? (
          <img src={logoUrl} alt={t('nav.logoAlt')} className="size-[26px] shrink-0 rounded-sm object-contain" />
        ) : (
          <div className="flex size-[26px] shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-[9px] text-muted-ink-2" aria-hidden>LOGO</div>
        )}
        <span className="max-w-60 truncate text-body font-semibold max-sm:hidden">{organization}</span>
      </div>
      <nav aria-label={t('shell.topbar.breadcrumb')} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-meta">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={`${index}-${crumb.label}`} className={cn('flex min-w-0 items-center gap-1.5', !last && 'max-sm:hidden')}>
                {index > 0 ? <span className="text-muted-ink-2 max-sm:hidden" aria-hidden>/</span> : null}
                {last && crumb.current ? (
                  <span aria-current="page" className="min-w-0 truncate font-heading text-section">{crumb.label}</span>
                ) : last && crumb.href ? (
                  <Link href={crumb.href} className="min-w-0 truncate font-heading text-section hover:underline">{crumb.label}</Link>
                ) : (
                  <span className="min-w-0 truncate text-muted-ink">{crumb.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <button type="button" onClick={onSearch} className="flex h-8 w-60 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-meta text-placeholder max-sm:w-auto">
        <Search className="size-3.5" aria-hidden />
        <span className="flex-1 text-left max-sm:sr-only">{t('shell.topbar.search')}</span>
        <kbd className="rounded-[3px] border border-line px-1 font-mono text-key max-sm:hidden">⌘K</kbd>
      </button>
      {extras}
      <button
        ref={helpButtonRef}
        type="button"
        onClick={onHelp}
        aria-label={t('shell.topbar.help')}
        aria-expanded={helpOpen}
        aria-controls={helpAside ? 'help-panel' : undefined}
        className={cn('flex size-[30px] shrink-0 items-center justify-center rounded-sm text-muted-ink hover:bg-hover hover:text-ink', helpOpen && 'bg-selected text-selected-ink')}
      >
        <CircleQuestionMark className="size-[18px]" aria-hidden />
      </button>
      <UserMenu user={user} build={build} version={version} />
    </header>
  );
}
