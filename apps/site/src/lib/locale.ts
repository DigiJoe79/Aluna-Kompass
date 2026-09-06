export type Locale = 'de' | 'en';
export interface L { de: string; en: string }

export function pick(text: L | undefined, locale: Locale): { value: string; fallback: 'de' | null } {
  if (!text) return { value: '', fallback: null };
  if (text[locale]) return { value: text[locale], fallback: null };
  return { value: text.de, fallback: locale === 'en' ? 'de' : null };
}

const DICT = {
  de: {
    nav: { help: 'Helfen', about: 'Über uns', dogs: 'Zuhause gesucht', projects: 'Projekte', faq: 'FAQ' },
    cta: { donate: 'Jetzt spenden', sponsor: 'Pate werden', meetDogs: 'Hunde kennenlernen →', allDogs: 'Alle Hunde ansehen', allProjects: 'Alle Projekte ansehen', toProject: 'Zum Projekt', readMore: 'Weiterlesen', moreStories: 'Mehr Geschichten lesen', toDonate: 'Zur Spendenseite', backToDogs: 'Alle Hunde ansehen', backToProjects: 'Alle Projekte', backToArticles: 'Alle Artikel', mail: 'E-Mail schreiben' },
    badge: { emergency: 'Notfall', reserved: 'Reserviert', adopted: 'Vermittelt' },
    filter: { label: 'Filter', all: 'Alle', emergency: 'Notfälle', germany: 'Schon in Deutschland', small: 'bis 45 cm', large: 'ab 45 cm', empty: 'Für diesen Filter ist gerade kein Hund gelistet.' },
    dog: { female: 'Hündin', male: 'Rüde', shelter: 'im Shelter', germany: 'in Deutschland', reserved: 'ist bereits reserviert — die Vorkontrolle läuft.', adopted: 'ist vermittelt und glücklich angekommen.', interest: 'Interesse an', external: 'Profil beim Vermittlungspartner' },
    story: { before: 'Vorher', after: 'Nachher', found: 'hat ihre Familie gefunden.', year: 'Vermittlung' },
    project: { ongoing: 'Dauerprojekt', shortTerm: 'Kurzzeitprojekt', donateFor: 'Jetzt für dieses Projekt spenden.' },
    footer: { website: 'Webseite', help: 'Helfen', imprint: 'Impressum', privacy: 'Datenschutz', contact: 'Kontakt', section11: 'Erlaubnis nach § 11 TSchG', pending: 'in Bearbeitung', granted: 'erteilt am', bank: 'Bankverbindung' },
    bp: { load: 'Formular für {label} laden', title: 'Spendenformular laden', open: 'betterplace.org öffnen', note: 'Formular bereitgestellt von betterplace.org.' },
    lists: {
      dogs: {
        eyebrow: 'Zuhause gesucht',
        title: 'Diese Hunde suchen ein *Zuhause.*',
        lede: 'Jeder von ihnen hat eine Geschichte — und wartet auf den Menschen, der seine schreibt. Die Vermittlung übernehmen wir gemeinsam mit unserem Partnerverein Hundeblicke e.V.',
      },
      stories: {
        eyebrow: 'Glückliche Vermittlungen',
        title: 'Sie haben es *geschafft.*',
        lede: 'Es gibt keinen schöneren Beweis, dass sich unsere Arbeit lohnt: Hunde, die ihre Familie gefunden haben. Hier erzählen ihre Menschen, wie aus einem Shelter-Bewohner ein Familienmitglied wurde.',
      },
      projects: {
        eyebrow: 'Projekte',
        title: 'Wofür wir *sammeln.*',
        lede: 'Aluna arbeitet projektorientiert — laufende Dauerprojekte und zeitkritische Kurzzeitprojekte, transparent über Betterplace.org abgerechnet.',
      },
      articles: {
        eyebrow: 'Wissenswertes',
        title: 'Was seriösen Tierschutz *ausmacht.*',
        lede: 'Ratgeber rund um Adoption, Transport und das Leben mit einem Tierschutzhund. Damit du weißt, worauf du dich einlässt — und dich darauf freuen kannst.',
      },
      faq: {
        eyebrow: 'FAQ',
        title: 'Häufige *Fragen.*',
        lede: 'Antworten rund um Spende, Adoption, Transport und Datenschutz. Ist deine Frage nicht dabei? Schreib uns einfach — wir helfen gern weiter.',
      },
      team: {
        eyebrow: 'Unser Team',
        title: 'Menschen, die nicht *wegsehen.*',
        lede: 'Hinter Aluna Tierhilfe steht ein kleines, ehrenamtliches Team. Was uns verbindet, ist die Überzeugung, dass jeder Hund ein gutes Leben verdient — und der Wille, dafür anzupacken.',
      },
    },
    misc: { skip: 'Zum Inhalt springen', menu: 'Menü', lang: 'Sprache', nonprofit: 'Gemeinnützig', founded: 'Gegründet', notFound: 'Diese Seite hat sich *verlaufen.*', home: 'Zur Startseite' },
  },
  en: {
    nav: { help: 'Help', about: 'About us', dogs: 'Looking for a home', projects: 'Projects', faq: 'FAQ' },
    cta: { donate: 'Donate now', sponsor: 'Become a sponsor', meetDogs: 'Meet the dogs →', allDogs: 'See all dogs', allProjects: 'See all projects', toProject: 'To the project', readMore: 'Read more', moreStories: 'More stories', toDonate: 'To the donation page', backToDogs: 'See all dogs', backToProjects: 'All projects', backToArticles: 'All articles', mail: 'Write an e-mail' },
    badge: { emergency: 'Urgent', reserved: 'Reserved', adopted: 'Adopted' },
    filter: { label: 'Filter', all: 'All', emergency: 'Urgent', germany: 'Already in Germany', small: 'up to 45 cm', large: 'from 45 cm', empty: 'No dog matches this filter right now.' },
    dog: { female: 'Female', male: 'Male', shelter: 'at the shelter', germany: 'in Germany', reserved: 'is already reserved — the home check is under way.', adopted: 'has been adopted and arrived safely.', interest: 'Interested in', external: 'Profile at our partner' },
    story: { before: 'Before', after: 'After', found: 'has found a family.', year: 'Adopted' },
    project: { ongoing: 'Ongoing project', shortTerm: 'Short-term project', donateFor: 'Donate to this project.' },
    footer: { website: 'Website', help: 'Help', imprint: 'Imprint', privacy: 'Privacy', contact: 'Contact', section11: 'Permit under § 11 German Animal Welfare Act', pending: 'pending', granted: 'granted on', bank: 'Bank details' },
    bp: { load: 'Load the donation form for {label}', title: 'Load donation form', open: 'open betterplace.org', note: 'Form provided by betterplace.org.' },
    lists: {
      dogs: {
        eyebrow: 'Looking for a home',
        title: 'These dogs are looking for a *home.*',
        lede: 'Every one of them has a story — and is waiting for the human who writes its next chapter. Adoptions are handled together with our partner organization.',
      },
      stories: {
        eyebrow: 'Happy adoptions',
        title: 'They made *it.*',
        lede: 'There is no better proof that our work matters: dogs who found their families. Here their adopters share their stories.',
      },
      projects: {
        eyebrow: 'Projects',
        title: 'What we are *raising funds for.*',
        lede: 'We work project-based — ongoing long-term projects and time-critical urgent appeals, transparently handled via Betterplace.org.',
      },
      articles: {
        eyebrow: 'Insights',
        title: 'What serious animal welfare *is about.*',
        lede: 'Advice and guides on adoption, transport, and living with a rescue dog.',
      },
      faq: {
        eyebrow: 'FAQ',
        title: 'Frequently asked *questions.*',
        lede: 'Answers regarding donations, adoption, transport, and privacy. Got another question? Contact us anytime.',
      },
      team: {
        eyebrow: 'Our Team',
        title: 'People who do not look *away.*',
        lede: 'Behind Aluna is a small, volunteer-run team united by the conviction that every dog deserves a safe, loving life.',
      },
    },
    misc: { skip: 'Skip to content', menu: 'Menu', lang: 'Language', nonprofit: 'Non-profit', founded: 'Founded', notFound: 'This page got *lost.*', home: 'Back to the start page' },
  },
} as const;

export type Ui = (typeof DICT)['de'];
export const ui = (locale: Locale): Ui => DICT[locale] as Ui;

export function emphasize(title: string): string {
  // *Wort* → <em>Wort</em> (nur für Titel; Fließtext geht durch @kompass/markdown)
  return title.replace(/[<>]/g, '').replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
