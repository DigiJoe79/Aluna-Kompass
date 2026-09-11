/**
 * Vereinsweite Angaben, die zur Seitenstruktur gehören und nicht in Kompass
 * gepflegt werden. Ein neuer Verein trägt hier seinen Namen und seine
 * Kontaktdaten ein. Was sich häufig ändert — Claim, Startseitentext,
 * Bankverbindung, Beitrag — steht als Variable in Kompass.
 */
export const SITE = {
  name: 'Musterverein',
  /** Fällt ein, wenn die Variable „Claim“ in Kompass noch leer ist. */
  fallbackClaim: 'Gemeinsam für unsere Sache.',
  email: 'info@example.org',
  address: 'Musterstraße 1, 00000 Musterstadt',
};
