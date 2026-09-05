import type { Locale } from './locale';

export type Kind =
  | 'home'
  | 'help'
  | 'donate'
  | 'sponsor'
  | 'membership'
  | 'about'
  | 'team'
  | 'partners'
  | 'articles'
  | 'article'
  | 'faq'
  | 'contact'
  | 'imprint'
  | 'privacy'
  | 'statutes'
  | 'adoption-process'
  | 'dogs'
  | 'dog'
  | 'stories'
  | 'projects'
  | 'project';

export const ROUTES: Record<Kind, { de: string; en: string }> = {
  home: { de: '/', en: '/en/' },
  help: { de: '/helfen/', en: '/en/help/' },
  donate: { de: '/spenden/', en: '/en/donate/' },
  sponsor: { de: '/helfen/tierpate-werden/', en: '/en/sponsor/' },
  membership: { de: '/helfen/foerdermitglied-werden/', en: '/en/membership/' },
  about: { de: '/ueber-uns/', en: '/en/about/' },
  team: { de: '/ueber-uns/unser-team/', en: '/en/team/' },
  partners: { de: '/ueber-uns/unsere-partner/', en: '/en/partners/' },
  articles: { de: '/wissenswertes/', en: '/en/good-to-know/' },
  article: { de: '/wissenswertes/', en: '/en/good-to-know/' },
  faq: { de: '/faq/', en: '/en/faq/' },
  contact: { de: '/kontakt/', en: '/en/contact/' },
  imprint: { de: '/impressum/', en: '/en/imprint/' },
  privacy: { de: '/datenschutz/', en: '/en/privacy/' },
  statutes: { de: '/satzung/', en: '/en/statutes/' },
  'adoption-process': { de: '/ablauf-der-adoption/', en: '/en/adoption-process/' },
  dogs: { de: '/zuhause-gesucht/', en: '/en/looking-for-a-home/' },
  dog: { de: '/zuhause-gesucht/', en: '/en/looking-for-a-home/' },
  stories: { de: '/glueckliche-vermittlungen/', en: '/en/happy-endings/' },
  projects: { de: '/projekte/', en: '/en/projects/' },
  project: { de: '/projekte/', en: '/en/projects/' },
};

const WITH_SLUG: Kind[] = ['dog', 'project', 'article'];

export function pathFor(kind: Kind, locale: Locale, slug?: string): string {
  const base = ROUTES[kind][locale];
  return WITH_SLUG.includes(kind) && slug ? `${base}${slug}/` : base;
}

export function alternateFor(path: string): { locale: Locale; other: { locale: Locale; path: string } } {
  const locale: Locale = path === '/en/' || path.startsWith('/en/') ? 'en' : 'de';
  const other: Locale = locale === 'de' ? 'en' : 'de';
  for (const kind of Object.keys(ROUTES) as Kind[]) {
    const base = ROUTES[kind][locale];
    if (path === base && !WITH_SLUG.includes(kind)) return { locale, other: { locale: other, path: ROUTES[kind][other] } };
    if (WITH_SLUG.includes(kind) && path.startsWith(base) && path.length > base.length) {
      const slug = path.slice(base.length).replace(/\/$/, '');
      return { locale, other: { locale: other, path: `${ROUTES[kind][other]}${slug}/` } };
    }
  }
  return { locale, other: { locale: other, path: ROUTES.home[other] } };
}

/** Pfad → Astro-Param (ohne führenden/abschließenden Slash); '/' ⇒ undefined. */
export const paramFor = (path: string): string | undefined => (path === '/' ? undefined : path.replace(/^\/|\/$/g, ''));
