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
    // Format und Anzeigebreite der Bildstellen nach dem CSS (`global.css`): Kompass bietet beim Ausschnitt nur das
    // Format der Stelle an und warnt, wenn ein Ausschnitt schmaler ist als die Stelle. Die Bühne hat kein festes
    // Format (`object-fit: cover` ohne `aspect-ratio`), unter 800 px ist sie so breit wie die Seite.
    heroImage: asset({ label: 'Bild auf der Startseite', width: 800 }),
    memberFee: number({ min: 0, label: 'Mitgliedsbeitrag im Jahr (Euro)' }),
    /**
     * Ein Datensatz aus einem Modul als Variable: Die Auswahl in Kompass zeigt
     * die veröffentlichten Projekte, gespeichert wird der Slug. Leer heißt: das
     * Template zeigt das erste Projekt nach Sortierung.
     */
    featuredProject: reference({ view: 'projects', label: 'Projekt auf der Startseite' }),
  },
  collections: {
    news: { label: 'Aktuelles', slug: true, publishable: true, fields: { title: text({ localized: true, label: 'Titel' }), body: markdown({ localized: true, label: 'Text' }), image: asset({ label: 'Bild', width: 680 }) } },
    team: { label: 'Team', sortable: true, max: 60, fields: { name: text({ label: 'Name' }), role: text({ localized: true, label: 'Aufgabe', size: 's' }), photo: asset({ label: 'Foto', ratio: '1:1', width: 430 }) } },
    faq: { label: 'Fragen und Antworten', sortable: true, fields: { question: text({ localized: true, label: 'Frage' }), answer: markdown({ localized: true, label: 'Antwort' }) } },
    documents: { label: 'Dokumente', fields: { title: text({ localized: true, label: 'Titel' }), file: asset({ accept: 'application/pdf', label: 'PDF' }) } },
  },
  /** Die Projekte aus dem Projektmodul; ohne aktives Modul verweigert der Export. */
  uses: ['projects'],
  /**
   * Bildstellen der Modul-Sichten (`images`, etwa `'projects.image': { ratio: ['16:10', '16:9'], width: 1080 }`)
   * deklariert ein Template, das ihre Bilder zeigt. Dieses zeigt die Projekte ohne Bild; ohne Angabe bietet Kompass
   * jedes Format an.
   */
  images: {},
});
