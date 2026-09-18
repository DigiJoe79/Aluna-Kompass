import type { Locale } from '../lib/locale';
import type { Kind } from '../lib/routes';

/**
 * Feste Seitentexte. Anders als Aktuelles, Team oder die Variablen stehen diese
 * Texte **nicht** in Kompass — sie gehören zur Struktur der Seite und werden
 * hier bearbeitet. Bewusst neutral gehalten: ein neuer Verein ersetzt sie durch
 * seine eigenen. Markdown ist erlaubt.
 *
 * Jede Sprache steht vollständig da. Ein fehlender Eintrag fiele nicht auf die
 * andere Sprache zurück, sondern bliebe leer — anders als bei Inhalten aus
 * Kompass, wo `pick()` einen Rückfall kennt.
 */
export interface StaticPage {
  title: string;
  eyebrow: string;
  lede: string;
  body: string;
}

const DE: Partial<Record<Kind, StaticPage>> = {
  about: {
    title: 'Über uns',
    eyebrow: 'Der Verein',
    lede: 'Wer wir sind und wofür wir arbeiten.',
    body: [
      'Dieser Verein wurde von Menschen gegründet, die eine gemeinsame Sache voranbringen wollen. Wir arbeiten ehrenamtlich und finanzieren unsere Arbeit aus Mitgliedsbeiträgen und Spenden.',
      '',
      '## Unser Ziel',
      '',
      'Beschreibt hier in wenigen Sätzen, was der Verein erreichen möchte und wie er dabei vorgeht.',
      '',
      '## Wie wir arbeiten',
      '',
      'Erläutert hier eure Arbeitsweise, eure Projekte und wie Interessierte mitmachen können.',
    ].join('\n'),
  },
  donate: {
    title: 'Spenden',
    eyebrow: 'Unterstützen',
    lede: 'Jede Spende hilft uns, unsere Arbeit fortzusetzen.',
    body: [
      'Wir sind als gemeinnützig anerkannt und stellen für Spenden auf Wunsch eine Zuwendungsbestätigung aus. Ab einem bestimmten Betrag senden wir sie automatisch zu; bei kleineren Beträgen genügt gegenüber dem Finanzamt der Kontoauszug.',
      '',
      'Überweisungen richtet ihr bitte an das unten genannte Konto. Gebt als Verwendungszweck euren Namen und eure Anschrift an, damit wir die Bestätigung zuordnen können.',
    ].join('\n'),
  },
  join: {
    title: 'Mitglied werden',
    eyebrow: 'Mitmachen',
    lede: 'Werde Teil des Vereins und gestalte mit.',
    body: [
      'Als Mitglied unterstützt du unsere Arbeit dauerhaft und kannst bei der Mitgliederversammlung mitbestimmen. Der Jahresbeitrag ist unten genannt.',
      '',
      'Für den Beitritt schreibt uns bitte per E-Mail. Wir senden dir dann den Aufnahmeantrag zu.',
    ].join('\n'),
  },
  contact: {
    title: 'Kontakt',
    eyebrow: 'Erreichen',
    lede: 'So nehmt ihr Verbindung mit uns auf.',
    /** Anschrift und E-Mail stehen in den Vereinsdaten; die Seite zeigt sie unter diesem Text. */
    body: 'Am schnellsten erreicht ihr uns per E-Mail. Für förmliche Post nutzt bitte die Anschrift des Vereins.',
  },
  /**
   * Nur die Überschrift: Der Text des Impressums entsteht in `lib/imprint.ts`
   * aus den Vereinsdaten in Kompass. Bis zum 2026-09-15 stand hier
   * „Musterverein, Musterstraße 1, VR 0000“ — wer das Template übernahm und
   * publizierte, hatte ein falsches Impressum im Netz.
   */
  imprint: { title: 'Impressum', eyebrow: 'Angaben', lede: 'Angaben gemäß § 5 DDG.', body: '' },
  privacy: {
    title: 'Datenschutz',
    eyebrow: 'Angaben',
    lede: 'Wie wir mit personenbezogenen Daten umgehen.',
    body: [
      'Diese Seite ist eine statische Webseite. Beim Aufruf verarbeitet der Server, auf dem sie liegt, technisch notwendige Daten wie die IP-Adresse in Server-Logdateien. Eine darüber hinausgehende Verarbeitung findet auf dieser Seite nicht statt.',
      '',
      'Wenn ihr uns per E-Mail schreibt, verarbeiten wir die übermittelten Angaben zur Bearbeitung eurer Anfrage.',
      '',
      'Ersetzt diesen Text durch eure vollständige Datenschutzerklärung.',
    ].join('\n'),
  },
  statutes: {
    title: 'Satzung',
    eyebrow: 'Der Verein',
    lede: 'Die Satzung und weitere Vereinsdokumente zum Nachlesen.',
    body: 'Die geltende Fassung der Satzung sowie weitere Dokumente des Vereins findet ihr im Download-Bereich unten.',
  },
};

const EN: Partial<Record<Kind, StaticPage>> = {
  about: {
    title: 'About us',
    eyebrow: 'The association',
    lede: 'Who we are and what we work for.',
    body: [
      'This association was founded by people who wanted to move a shared cause forward. We work on a voluntary basis and fund our work through membership fees and donations.',
      '',
      '## Our goal',
      '',
      'Describe in a few sentences what the association wants to achieve and how it goes about it.',
      '',
      '## How we work',
      '',
      'Explain your way of working, your projects, and how people can join in.',
    ].join('\n'),
  },
  donate: {
    title: 'Donate',
    eyebrow: 'Support us',
    lede: 'Every donation helps us continue our work.',
    body: [
      'We are recognised as a non-profit and issue donation receipts on request. Above a certain amount we send them automatically; for smaller amounts the bank statement is enough for the tax office.',
      '',
      'Please send transfers to the account named below. State your name and address as the reference so that we can assign the receipt.',
    ].join('\n'),
  },
  join: {
    title: 'Become a member',
    eyebrow: 'Join in',
    lede: 'Become part of the association and help shape it.',
    body: [
      'As a member you support our work permanently and have a vote at the general meeting. The annual fee is named below.',
      '',
      'To join, please write to us by email. We will then send you the membership application.',
    ].join('\n'),
  },
  contact: {
    title: 'Contact',
    eyebrow: 'Reach us',
    lede: 'How to get in touch with us.',
    body: 'The quickest way to reach us is by email. For formal post, please use the address of the association.',
  },
  imprint: { title: 'Legal notice', eyebrow: 'Information', lede: 'Information pursuant to § 5 DDG.', body: '' },
  privacy: {
    title: 'Privacy',
    eyebrow: 'Information',
    lede: 'How we handle personal data.',
    body: [
      'This is a static website. When a page is requested, the server it is hosted on processes technically necessary data such as the IP address in server log files. No further processing takes place on this site.',
      '',
      'If you write to us by email, we process the information you send in order to handle your request.',
      '',
      'Replace this text with your full privacy policy.',
    ].join('\n'),
  },
  statutes: {
    title: 'Statutes',
    eyebrow: 'The association',
    lede: 'The statutes and further documents of the association.',
    body: 'You will find the current version of the statutes and further documents of the association in the download section below.',
  },
};

const BY_LOCALE: Record<Locale, Partial<Record<Kind, StaticPage>>> = { de: DE, en: EN };

export const pageFor = (locale: Locale, kind: Kind): StaticPage | undefined => BY_LOCALE[locale][kind];
