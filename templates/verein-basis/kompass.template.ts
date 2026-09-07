import { asset, defineTemplate, markdown, number, text } from '@kompass/site-template';

export default defineTemplate({
  name: 'Verein Basis',
  locales: ['de'],
  variables: {
    claim: text({ max: 120, localized: true, label: 'Claim' }),
    intro: markdown({ max: 2000, localized: true, label: 'Text auf der Startseite' }),
    heroImage: asset({ label: 'Bild auf der Startseite' }),
    donationAccount: text({ max: 200, localized: false, label: 'Hinweis zur Bankverbindung' }),
    memberFee: number({ min: 0, label: 'Mitgliedsbeitrag im Jahr (Euro)' }),
  },
  collections: {
    news: { label: 'Aktuelles', slug: true, publishable: true, fields: { title: text({ localized: true, label: 'Titel' }), body: markdown({ localized: true, label: 'Text' }), image: asset({ label: 'Bild' }) } },
    team: { label: 'Team', sortable: true, max: 60, fields: { name: text({ label: 'Name' }), role: text({ localized: true, label: 'Aufgabe' }), photo: asset({ label: 'Foto' }) } },
    faq: { label: 'Fragen und Antworten', sortable: true, fields: { question: text({ localized: true, label: 'Frage' }), answer: markdown({ localized: true, label: 'Antwort' }) } },
    documents: { label: 'Dokumente', fields: { title: text({ localized: true, label: 'Titel' }), file: asset({ accept: 'application/pdf', label: 'PDF' }) } },
  },
});
