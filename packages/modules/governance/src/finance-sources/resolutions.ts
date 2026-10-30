import { isModuleEnabled, type DbOrTx, type Deps } from '@kompass/core';
import type { ResolutionFacts } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { governanceCirculars, governanceMeetings, governanceResolutions } from '../schema';

/**
 * Quelle der Finanzen und Mitglieder (V-3): Art, Ergebnis, Beschlusstag und ob der Beschluss festgeschrieben ist —
 * über die Sitzung oder den Umlauf, an dem er hängt. Ohne Gremien oder unbekannt `null`. Schreibt nichts.
 */
export function resolutionFactsInternal(deps: Deps, db: DbOrTx, resolutionId: string): ResolutionFacts | null {
  if (!isModuleEnabled(deps, 'governance')) return null;
  const row = db.select().from(governanceResolutions).where(eq(governanceResolutions.id, resolutionId)).get();
  if (!row) return null;
  const sealedAt = row.meetingId
    ? db.select({ sealedAt: governanceMeetings.sealedAt }).from(governanceMeetings).where(eq(governanceMeetings.id, row.meetingId)).get()?.sealedAt
    : row.circularId
      ? db.select({ sealedAt: governanceCirculars.sealedAt }).from(governanceCirculars).where(eq(governanceCirculars.id, row.circularId)).get()?.sealedAt
      : null;
  return { kind: row.kind, final: sealedAt != null, outcome: row.outcome, decidedOn: row.decidedOn };
}
