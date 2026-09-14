import type { HelpEntry, ModuleManifest } from '@kompass/core';
import { matches } from './navigation';

/**
 * Die Hilfe der Kernseiten. Wie `CORE_ADMIN` in der Navigation: Der Kern
 * kennt keine Routen, die App ordnet zu.
 */
export const CORE_HELP: HelpEntry[] = [
  { href: '/', doc: 'startseite' },
  { href: '/profile', doc: 'profil' },
  { href: '/admin/media', doc: 'mediathek' },
  { href: '/admin/settings', doc: 'einstellungen/verein' },
  { href: '/admin/users', doc: 'einstellungen/nutzer-und-rollen' },
  { href: '/admin/roles', doc: 'einstellungen/nutzer-und-rollen' },
  { href: '/admin/audit', doc: 'einstellungen/aenderungsprotokoll' },
  { href: '/admin/retention', doc: 'einstellungen/aufbewahrung' },
  { href: '/admin/backup', doc: 'einstellungen/backup' },
  { href: '/admin/locales', doc: 'einstellungen/sprachen' },
  { href: '/admin/themes', doc: 'einstellungen/themes' },
  { href: '/admin/modules', doc: 'einstellungen/module' },
  { href: '/admin/documents', doc: 'einstellungen/dokumente' },
];

/** Kern plus die eingeschalteten Module — ein abgeschaltetes Modul hat keine Seiten, also keine Hilfe dazu. */
export function helpEntries(manifests: readonly ModuleManifest[], enabledKeys: ReadonlySet<string>): HelpEntry[] {
  return [...CORE_HELP, ...manifests.filter((m) => m.key !== 'core' && enabledKeys.has(m.key)).flatMap((m) => m.help ?? [])];
}

/** Die Handbuchseite zum Pfad: längster passender `href`; keine auf den Hilfeseiten selbst. */
export function helpDocFor(entries: HelpEntry[], pathname: string): string | null {
  if (matches('/help', pathname)) return null;
  let best: HelpEntry | null = null;
  for (const entry of entries) {
    if (!matches(entry.href, pathname)) continue;
    if (entry.href === '/' && pathname !== '/') continue;
    if (!best || entry.href.length > best.href.length) best = entry;
  }
  return best?.doc ?? null;
}
