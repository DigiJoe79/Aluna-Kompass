import { asset, defineTemplate, markdown, number, reference, text } from '@kompass/site-template';

export default defineTemplate({
  name: 'Verein Basis',
  locales: ['de', 'en'],
  /**
   * Deklariert wird nur, was sich im Betrieb ändert. Die Vereinsstammdaten —
   * Name, Anschrift, Kontakt, Bankverbindung, Registereintrag — liefert der
   * Kern jedem Template von sich aus unter `views.organization`; sie hier als
   * Variablen aufzuführen hieße, sie zweimal zu pflegen.
   */
  variables: {
    claim: text({ max: 120, localized: true, label: 'Claim' }),
    intro: markdown({ max: 2000, localized: true, label: 'Text auf der Startseite' }),
    heroImage: asset({ label: 'Bild auf der Startseite' }),
    memberFee: number({ min: 0, label: 'Mitgliedsbeitrag im Jahr (Euro)' }),
    /**
     * Ein Datensatz aus einem Modul als Variable: Die Auswahl in Kompass zeigt
     * die veröffentlichten Projekte, gespeichert wird der Slug. Leer heißt: das
     * Template zeigt das erste Projekt nach Sortierung.
     */
    featuredProject: reference({ view: 'projects', label: 'Projekt auf der Startseite' }),
  },
  collections: {
    news: { label: 'Aktuelles', slug: true, publishable: true, fields: { title: text({ localized: true, label: 'Titel' }), body: markdown({ localized: true, label: 'Text' }), image: asset({ label: 'Bild' }) } },
    team: { label: 'Team', sortable: true, max: 60, fields: { name: text({ label: 'Name' }), role: text({ localized: true, label: 'Aufgabe' }), photo: asset({ label: 'Foto' }) } },
    faq: { label: 'Fragen und Antworten', sortable: true, fields: { question: text({ localized: true, label: 'Frage' }), answer: markdown({ localized: true, label: 'Antwort' }) } },
    documents: { label: 'Dokumente', fields: { title: text({ localized: true, label: 'Titel' }), file: asset({ accept: 'application/pdf', label: 'PDF' }) } },
  },
  /** Die Projekte aus dem Projektmodul; ohne aktives Modul verweigert der Export. */
  uses: ['projects'],
});
