import type { CircularView } from '@kompass/module-governance';

export type CircularState = 'running' | 'overdue' | 'failed' | 'passed';

/**
 * Zustand eines Umlaufs für Marke und Kopf (Plan U2): festgeschrieben `adopted` → zustande gekommen, sonst nicht; offen
 * erreicht → zustande gekommen (auch nach der Frist), nicht mehr erreichbar → nicht zustande gekommen, nach der Frist
 * unvollständig → Frist verstrichen (nie stillschweigend gescheitert), sonst läuft. Schlüssel wie `STATUS_TONES.circular`.
 */
export function circularState(c: Pick<CircularView, 'deadline' | 'outcome' | 'sealedAt'> & { evaluation: Pick<CircularView['evaluation'], 'reached' | 'possible'> }, today: string): CircularState {
  if (c.sealedAt) return c.outcome === 'adopted' ? 'passed' : 'failed';
  if (c.evaluation.reached) return 'passed';
  if (!c.evaluation.possible) return 'failed';
  return today > c.deadline ? 'overdue' : 'running';
}
