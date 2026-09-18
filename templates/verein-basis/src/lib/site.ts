import type { BoardMember } from './imprint';

/**
 * Was der Verein einmal einträgt und was Kompass nicht kennt.
 *
 * Alles andere — Name, Anschrift, Kontakt, Bankverbindung, Registereintrag —
 * kommt aus den Vereinsdaten in Kompass und steht deshalb **nicht** hier.
 * Wer hier etwas ergänzt, das es in den Einstellungen schon gibt, pflegt es
 * ab dann zweimal.
 */
export const SITE = {
  /** Fällt ein, wenn die Variable „Claim“ in Kompass noch leer ist. */
  fallbackClaim: { de: 'Gemeinsam für unsere Sache.', en: 'Together for our cause.' },
};

/**
 * Der Vorstand für das Impressum. § 5 DDG verlangt die Vertretungsberechtigten
 * namentlich — „der Vorstand“ allein genügt nicht. Kompass führt die Ämter
 * nicht, deshalb stehen sie hier; nach einer Neuwahl hier ändern.
 *
 * Leer gelassen schreibt das Impressum „den Vorstand“ — das baut, erfüllt die
 * Pflicht aber nicht.
 */
export const BOARD: readonly BoardMember[] = [
  { name: 'Alex Beispiel', role: { de: 'Vorsitz', en: 'chair' } },
  { name: 'Kim Muster', role: { de: 'Kasse', en: 'treasurer' } },
];
