import type { MembershipRow } from './schema';

export const MEMBERSHIP_STATUSES = ['applied', 'rejected', 'active', 'ending', 'ended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Nicht beendet: Ein Kontakt hat höchstens eine Mitgliedschaft in einem dieser Zustände (Spec § 3.2). */
export const RUNNING_STATUSES: readonly MembershipStatus[] = ['applied', 'active', 'ending'];

/**
 * Der Zustand, berechnet aus den Tagen (Prinzip 5). `endsOn` ist der letzte Tag der Mitgliedschaft: Sie endet mit
 * Ablauf dieses Tages, bis dahin ist sie `ending`.
 */
export function membershipStatus(row: Pick<MembershipRow, 'admittedOn' | 'rejectedOn' | 'endsOn'> & Partial<MembershipRow>, today: string): MembershipStatus {
  if (row.rejectedOn) return 'rejected';
  if (!row.admittedOn) return 'applied';
  if (row.endsOn) return row.endsOn >= today ? 'ending' : 'ended';
  return 'active';
}
