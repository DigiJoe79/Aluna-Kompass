import type { Localized } from '@kompass/site-template';
import template from '../../kompass.template';

/**
 * Die Sprachen dieses Templates — aus der Deklaration, nicht aus einer zweiten
 * Liste. Ein Verein, der einsprachig bleibt, streicht `'en'` in
 * `kompass.template.ts`: Dann entfallen die `/en/`-Seiten und der
 * Sprachumschalter von selbst, ohne dass er hier etwas ändern müsste.
 *
 * Die erste Sprache liegt an der Wurzel (`/spenden/`), jede weitere unter
 * ihrem Kürzel (`/en/donate/`). So bleiben bestehende Adressen gültig, wenn
 * ein Verein später eine Sprache ergänzt.
 */
export type Locale = keyof typeof DICT;
export const LOCALES = template.locales as readonly Locale[];
export const DEFAULT_LOCALE: Locale = LOCALES[0]!;

/**
 * Der Wert eines mehrsprachigen Feldes — und ob er aus der Vorgabesprache
 * stammt. Ein Verein pflegt selten alles in jeder Sprache; ein leerer Absatz
 * wäre die schlechtere Antwort als der deutsche Text, solange die Seite ihn
 * als fremdsprachig auszeichnet (`lang`-Attribut, siehe `Text.astro`).
 */
export function pick(
  field: Localized | string | undefined | null,
  locale: Locale,
): { value: string; fallback: Locale | null } {
  if (field == null) return { value: '', fallback: null };
  if (typeof field === 'string') return { value: field, fallback: null };
  const own = field[locale];
  if (own) return { value: own, fallback: null };
  const base = field[DEFAULT_LOCALE] ?? Object.values(field)[0] ?? '';
  return { value: base, fallback: base && locale !== DEFAULT_LOCALE ? DEFAULT_LOCALE : null };
}

/** Nur der Wert — für Stellen, an denen ein Rückfall nicht ausgezeichnet wird (Titel, Attribute). */
export const text = (field: Localized | string | undefined | null, locale: Locale): string => pick(field, locale).value;

/**
 * Die Oberflächentexte des Templates. Sie gehören nicht nach Kompass: Sie
 * ändern sich nur, wenn jemand das Template bearbeitet, und wären in einer
 * Übersetzungsdatei je Verein dieselben.
 */
const DICT = {
  de: {
    nav: { about: 'Über uns', team: 'Team', news: 'Aktuelles', faq: 'Fragen und Antworten', donate: 'Spenden', join: 'Mitglied werden' },
    footer: { contact: 'Kontakt', imprint: 'Impressum', privacy: 'Datenschutz', statutes: 'Satzung', bank: 'Bankverbindung', nonprofit: 'ist ein gemeinnütziger Verein und arbeitet nicht profitorientiert.' },
    home: { news: 'Aktuelles', allNews: 'Alle Meldungen', donate: 'Spenden', join: 'Mitglied werden', welcome: 'Willkommen' },
    news: { eyebrow: 'Neuigkeiten', title: 'Aktuelles', lede: 'Meldungen und Berichte aus dem Vereinsleben.', empty: 'Zurzeit gibt es keine Meldungen.', back: 'Alle Meldungen' },
    team: { eyebrow: 'Wer wir sind', title: 'Team', lede: 'Die Menschen hinter dem Verein.', empty: 'Die Teamliste wird gerade zusammengestellt.' },
    faq: { eyebrow: 'Nachgefragt', title: 'Fragen und Antworten', lede: 'Was uns am häufigsten gefragt wird.', empty: 'Hier sammeln wir bald die häufigsten Fragen.' },
    misc: { skip: 'Zum Inhalt springen', menu: 'Menü', language: 'Sprache', contactBox: 'So erreicht ihr uns', fee: 'Jahresbeitrag', feeSuffix: 'im Jahr', notFound: 'Seite nicht gefunden', notFoundLede: 'Diese Seite gibt es nicht (mehr).', home: 'Zur Startseite', pdf: 'PDF', mailSubject: 'Anfrage an' },
  },
  en: {
    nav: { about: 'About us', team: 'Team', news: 'News', faq: 'Questions and answers', donate: 'Donate', join: 'Become a member' },
    footer: { contact: 'Contact', imprint: 'Legal notice', privacy: 'Privacy', statutes: 'Statutes', bank: 'Bank details', nonprofit: 'is a registered non-profit and does not operate for profit.' },
    home: { news: 'News', allNews: 'All news', donate: 'Donate', join: 'Become a member', welcome: 'Welcome' },
    news: { eyebrow: 'Latest', title: 'News', lede: 'Reports and announcements from the association.', empty: 'There are no news items at the moment.', back: 'All news' },
    team: { eyebrow: 'Who we are', title: 'Team', lede: 'The people behind the association.', empty: 'The team list is being put together.' },
    faq: { eyebrow: 'Asked often', title: 'Questions and answers', lede: 'What people ask us most.', empty: 'We are collecting the most frequent questions here.' },
    misc: { skip: 'Skip to content', menu: 'Menu', language: 'Language', contactBox: 'How to reach us', fee: 'Annual fee', feeSuffix: 'per year', notFound: 'Page not found', notFoundLede: 'This page does not exist (any more).', home: 'To the start page', pdf: 'PDF', mailSubject: 'Enquiry to' },
  },
} as const;

export type Ui = (typeof DICT)['de'];

/**
 * Die Oberflächentexte einer Sprache. Wer in `kompass.template.ts` eine
 * Sprache deklariert, für die unten kein Eintrag steht, bekommt die
 * Vorgabesprache — eine Seite mit deutscher Navigation ist brauchbarer als
 * eine mit leeren Beschriftungen. Der Weg dahin: einen Block wie `de` und `en`
 * ergänzen.
 */
export const ui = (locale: Locale): Ui => (DICT[locale] ?? DICT[DEFAULT_LOCALE]) as Ui;

/** Der Name der Sprache in ihrer eigenen Sprache — so schreibt man einen Sprachumschalter. */
export const ENDONYM: Record<Locale, string> = { de: 'Deutsch', en: 'English' };
