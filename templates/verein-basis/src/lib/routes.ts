/**
 * Die Seiten dieses Templates und ihre Pfade. Ein Verein, der die Struktur
 * ändern will, bearbeitet diese Datei und die Seiten dazu — das ist Astro-Code,
 * kein von Kompass verwalteter Inhalt.
 */
export type Kind =
  | 'home'
  | 'about'
  | 'team'
  | 'news'
  | 'article'
  | 'faq'
  | 'donate'
  | 'join'
  | 'contact'
  | 'imprint'
  | 'privacy'
  | 'statutes';

export const ROUTES: Record<Kind, string> = {
  home: '/',
  about: '/ueber-uns/',
  team: '/team/',
  news: '/aktuelles/',
  article: '/aktuelles/',
  faq: '/fragen-und-antworten/',
  donate: '/spenden/',
  join: '/mitglied-werden/',
  contact: '/kontakt/',
  imprint: '/impressum/',
  privacy: '/datenschutz/',
  statutes: '/satzung/',
};

/** Kinds mit einem Slug-Segment hinter dem Grundpfad. */
const WITH_SLUG: Kind[] = ['article'];

export function pathFor(kind: Kind, slug?: string): string {
  const base = ROUTES[kind];
  return WITH_SLUG.includes(kind) && slug ? `${base}${slug}/` : base;
}

/** Pfad → Astro-Param (ohne führenden/abschließenden Slash); '/' ⇒ undefined. */
export const paramFor = (p: string): string | undefined => (p === '/' ? undefined : p.replace(/^\/|\/$/g, ''));

/** Die Hauptnavigation, in Reihenfolge. */
export const NAV: { kind: Kind; label: string }[] = [
  { kind: 'about', label: 'Über uns' },
  { kind: 'team', label: 'Team' },
  { kind: 'news', label: 'Aktuelles' },
  { kind: 'faq', label: 'Fragen und Antworten' },
  { kind: 'donate', label: 'Spenden' },
  { kind: 'join', label: 'Mitglied werden' },
];

/** Die Fusszeilen-Links, in Reihenfolge. */
export const FOOTER_LINKS: { kind: Kind; label: string }[] = [
  { kind: 'contact', label: 'Kontakt' },
  { kind: 'imprint', label: 'Impressum' },
  { kind: 'privacy', label: 'Datenschutz' },
  { kind: 'statutes', label: 'Satzung' },
];
