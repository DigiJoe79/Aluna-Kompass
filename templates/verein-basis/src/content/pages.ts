import type { Kind } from '../lib/routes';

/**
 * Feste Seitentexte. Anders als Aktuelles, Team oder die Variablen stehen diese
 * Texte **nicht** in Kompass — sie gehören zur Struktur der Seite und werden
 * hier bearbeitet. Bewusst neutral gehalten: ein neuer Verein ersetzt sie durch
 * seine eigenen. Markdown ist erlaubt.
 */
export interface StaticPage {
  title: string;
  eyebrow: string;
  lede: string;
  body: string;
}

export const PAGES: Partial<Record<Kind, StaticPage>> = {
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
      'Für den Beitritt schreibt uns bitte über das Kontaktformular oder per E-Mail. Wir senden dir dann den Aufnahmeantrag zu.',
    ].join('\n'),
  },
  contact: {
    title: 'Kontakt',
    eyebrow: 'Erreichen',
    lede: 'So nehmt ihr Verbindung mit uns auf.',
    body: [
      'Am schnellsten erreicht ihr uns per E-Mail. Für förmliche Post nutzt bitte die Anschrift des Vereins.',
      '',
      '**E-Mail:** info@example.org',
      '',
      '**Anschrift:** Musterverein, Musterstraße 1, 00000 Musterstadt',
    ].join('\n'),
  },
  imprint: {
    title: 'Impressum',
    eyebrow: 'Angaben',
    lede: 'Angaben gemäß § 5 DDG.',
    body: [
      '**Musterverein**  ',
      'Musterstraße 1  ',
      '00000 Musterstadt',
      '',
      'Vereinsregister: Amtsgericht Musterstadt, VR 0000',
      '',
      '**Vertreten durch:** den Vorstand',
      '',
      '**Kontakt:** info@example.org',
      '',
      'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: der Vorstand, Anschrift wie oben.',
    ].join('\n'),
  },
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
    body: [
      'Die geltende Fassung der Satzung sowie weitere Dokumente des Vereins findet ihr im Download-Bereich unten.',
    ].join('\n'),
  },
};
