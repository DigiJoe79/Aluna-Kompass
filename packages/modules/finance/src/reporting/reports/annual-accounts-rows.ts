import type { DonationPlatform, INCOME_KINDS } from '../../ledger/codes';
import type { Sphere } from '../../ledger/queries';

/**
 * Jahresrechnung F2 (Spec 0.4.5 Teil J, ITZ 7): die Zeilen der Mittelherkunft in fester Reihenfolge und die feste
 * Zuordnung `incomeKind → Zeile`. Rein. Geldauflagen stehen nach „Zuwendungen anderer Organisationen“ (Plan J1,
 * Entscheidung 7); die Zeile entfällt, wenn sie in beiden Jahren 0 ist.
 */
export const INCOME_ROWS = ['cashDonations', 'inKindDonations', 'bequests', 'membershipFees', 'publicGrants', 'otherOrganizations', 'courtFines', 'revenue', 'assetManagement', 'other'] as const;
export type IncomeRow = (typeof INCOME_ROWS)[number];
export type IncomeKind = (typeof INCOME_KINDS)[number];

export interface IncomeRowInput {
  incomeKind: IncomeKind | null;
  sphere: Sphere;
  donationPlatform: DonationPlatform | null;
  /** Aufwandsverzicht mit bestandener Prüfung (St-L-11): Buchung eines freigegebenen Antrags mit unterschriebenem Verzicht. */
  waiverPassed: boolean;
}

/** Die Zeile einer Einnahmezeile (Spec-Tabelle F2; St-H-1, St-L-9, St-L-10, St-L-11). */
export function incomeRowOf(line: IncomeRowInput): IncomeRow {
  if (line.donationPlatform !== null) return 'cashDonations';
  switch (line.incomeKind) {
    case 'donation':
      return 'cashDonations';
    case 'expenseWaiver':
      return line.waiverPassed ? 'cashDonations' : 'other';
    case 'inKindDonation':
      return 'inKindDonations';
    case 'inheritance':
      return 'bequests';
    case 'membershipFee':
      return 'membershipFees';
    case 'publicGrant':
      return 'publicGrants';
    case 'bodyGrant':
      return 'otherOrganizations';
    case 'courtFine':
      return 'courtFines';
    case 'sales':
      return 'revenue';
    case 'fees':
      return line.sphere === 'assetManagement' ? 'assetManagement' : 'revenue';
    case 'sponsoring':
      return line.sphere === 'business' ? 'revenue' : 'other';
    case 'interest':
    case 'rent':
      return 'assetManagement';
    default:
      return 'other';
  }
}
