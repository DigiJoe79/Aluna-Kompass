/**
 * Der Begleittext der Grundausstattung, in der führenden Sprache der
 * Installation (Prinzip 7: Nutzdaten der Grundausstattung aus einer
 * Sprachtabelle). Ab der Einrichtung gehört der Baustein dem Verein.
 * Platzhalter: {Anrede}, {Name}, {Betreff}, {Datum}, {Nummer}, {Verein}.
 */
export const MAIL_BODY_DEFAULTS: Record<string, { name: string; body: string }> = {
  de: {
    name: 'Begleittext E-Mail',
    body: 'Guten Tag {Name},\n\nanbei erhalten Sie das Dokument „{Betreff}“ ({Nummer}) als PDF.\n\nMit freundlichen Grüßen\n{Verein}',
  },
  en: {
    name: 'E-mail cover text',
    body: 'Dear {Name},\n\nplease find attached the document “{Betreff}” ({Nummer}) as a PDF.\n\nKind regards\n{Verein}',
  },
};

/** Text der Testmail an die eigene Adresse — reiner Text, kein Baustein. */
export const TEST_MAIL_TEXTS: Record<string, { subject: string; body: string }> = {
  de: { subject: 'Testmail aus Kompass', body: 'Diese Testmail zeigt, dass der E-Mail-Versand von Kompass eingerichtet ist.\n\n{Verein}' },
  en: { subject: 'Test mail from Kompass', body: 'This test mail shows that e-mail delivery in Kompass is set up.\n\n{Verein}' },
};
