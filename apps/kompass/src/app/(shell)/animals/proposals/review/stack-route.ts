import type { ProposalKind, ProposalListItem } from '@kompass/module-animals';

export type StackReason = 'conflict' | 'hints' | 'notice' | 'sameAs' | 'missingPrimaryPhoto' | 'missingSummary' | 'adoptedYear';
export type StackRight = { kind: 'accept'; publish: boolean } | { kind: 'review'; reasons: StackReason[] };

/**
 * Was „rechts“ im Stapel heißt (Spec § 6, Board 3c/3e): mit der Vorauswahl annehmen — ein vollständiger neuer Hund
 * geht dabei online —, oder auf die Prüfseite, wenn Konflikt, Zweifelsfall, Hinweis, Zuordnung oder ein fehlendes
 * Titelbild oder Kurztext eine bewusste Entscheidung verlangen. So geht nichts Unvollständiges mit einem Wisch online.
 */
export function rightAction(item: Pick<ProposalListItem, 'conflictCount' | 'hintCount' | 'missing'> & { kind: ProposalKind }, o: { needsYear?: boolean } = {}): StackRight {
  const reasons: StackReason[] = [];
  // Status wird „vermittelt“, und niemand nennt das Jahr: Der Dienst verlangt es, also die Prüfseite (Reviewer I3).
  if (o.needsYear) reasons.push('adoptedYear');
  if (item.kind === 'notice') reasons.push('notice');
  if (item.kind === 'sameAs') reasons.push('sameAs');
  if (item.conflictCount > 0) reasons.push('conflict');
  if (item.hintCount > 0) reasons.push('hints');
  if (item.missing.includes('primaryPhoto')) reasons.push('missingPrimaryPhoto');
  if (item.missing.includes('summary')) reasons.push('missingSummary');
  return reasons.length > 0 ? { kind: 'review', reasons } : { kind: 'accept', publish: item.kind === 'create' };
}
