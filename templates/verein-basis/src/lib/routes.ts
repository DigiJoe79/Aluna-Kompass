import { DEFAULT_LOCALE, LOCALES, ui, type Locale } from './locale';

/**
 * Die Seiten dieses Templates und ihre Pfade, je Sprache. Ein Verein, der die
 * Struktur ändern will, bearbeitet diese Datei und die Seiten dazu — das ist
 * Astro-Code, kein von Kompass verwalteter Inhalt.
 *
 * Die Vorgabesprache liegt an der Wurzel, jede weitere unter ihrem Kürzel.
 * Übersetzte Adressen (`/en/donate/` statt `/en/spenden/`) sind Absicht: Wer
 * die Seite auf Englisch liest, soll sie auch auf Englisch verlinken können.
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

const SEGMENTS: Record<Locale, Record<Kind, string>> = {
  de: {
    home: '',
    about: 'ueber-uns',
    team: 'team',
    news: 'aktuelles',
    article: 'aktuelles',
    faq: 'fragen-und-antworten',
    donate: 'spenden',
    join: 'mitglied-werden',
    contact: 'kontakt',
    imprint: 'impressum',
    privacy: 'datenschutz',
    statutes: 'satzung',
  },
  en: {
    home: '',
    about: 'about-us',
    team: 'team',
    news: 'news',
    article: 'news',
    faq: 'questions-and-answers',
    donate: 'donate',
    join: 'become-a-member',
    contact: 'contact',
    imprint: 'legal-notice',
    privacy: 'privacy',
    statutes: 'statutes',
  },
};

/** Kinds mit einem Slug-Segment hinter dem Grundpfad. */
const WITH_SLUG: Kind[] = ['article'];

/** Das Präfix einer Sprache: leer für die Vorgabesprache, sonst `/en`. */
const prefixFor = (locale: Locale): string => (locale === DEFAULT_LOCALE ? '' : `/${locale}`);

export function pathFor(locale: Locale, kind: Kind, slug?: string): string {
  const segment = SEGMENTS[locale][kind];
  const parts = [segment, WITH_SLUG.includes(kind) && slug ? slug : ''].filter(Boolean);
  return `${prefixFor(locale)}/${parts.map((p) => `${p}/`).join('')}`;
}

/** Pfad → Astro-Param (ohne führenden/abschließenden Slash); '/' ⇒ undefined. */
export const paramFor = (p: string): string | undefined => {
  const trimmed = p.replace(/^\/|\/$/g, '');
  return trimmed === '' ? undefined : trimmed;
};

/** Dieselbe Seite in einer anderen Sprache — für den Umschalter und `hreflang`. */
export const alternatesFor = (kind: Kind, slug?: string): { locale: Locale; path: string }[] =>
  LOCALES.map((locale) => ({ locale, path: pathFor(locale, kind, slug) }));

/** Die Hauptnavigation, in Reihenfolge. */
export const navFor = (locale: Locale): { kind: Kind; label: string }[] => {
  const t = ui(locale).nav;
  return [
    { kind: 'about', label: t.about },
    { kind: 'team', label: t.team },
    { kind: 'news', label: t.news },
    { kind: 'faq', label: t.faq },
    { kind: 'donate', label: t.donate },
    { kind: 'join', label: t.join },
  ];
};

/** Die Fusszeilen-Links, in Reihenfolge. */
export const footerLinksFor = (locale: Locale): { kind: Kind; label: string }[] => {
  const t = ui(locale).footer;
  return [
    { kind: 'contact', label: t.contact },
    { kind: 'imprint', label: t.imprint },
    { kind: 'privacy', label: t.privacy },
    { kind: 'statutes', label: t.statutes },
  ];
};
