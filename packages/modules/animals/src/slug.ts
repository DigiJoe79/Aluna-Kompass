export const ANIMAL_SLUG_NAME_MAX = 60;

/**
 * Der Slug eines Tiers: Name in ASCII, Bindestrich, das Ende der Tier-ID
 * (Spec 2026-10-05 „Tier-Slug fest“). Weil die ID nie wiederkehrt, kehrt
 * auch kein Slug wieder — auch nicht nach dem Löschen eines gleichnamigen
 * Hundes. Dieselbe Regel hat am 2026-10-05 den Bestand umgestellt
 * (Backlog 56); sie zu ändern, bräche die Gleichheit mit ihm.
 */
export function animalSlug(name: string, id: string, length = 4): string {
  const ascii = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const namePart = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, ANIMAL_SLUG_NAME_MAX).replace(/-+$/, '');
  const idPart = id.slice(-length).toLowerCase();
  return namePart ? `${namePart}-${idPart}` : idPart;
}
