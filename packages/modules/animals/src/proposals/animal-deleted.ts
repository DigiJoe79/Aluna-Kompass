import { isoNow, recordAudit, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { animalProposals } from '../schema';
import { proposalAudit, releaseImages } from './audit';

/**
 * Tier gelöscht, solange Vorschläge offen sind (Spec § 3): `rejected` mit Grund `animalDeleted`. Läuft in
 * `deleteAnimal` **vor** dem Löschen des Tiers — danach gäbe es den Namen für das Protokoll nicht mehr. Gibt die
 * Dateinamen der Zwischenablage zurück; der Aufrufer löscht sie nach der Transaktion.
 */
export function rejectOpenProposalsOfAnimal(tx: DbOrTx, deps: Deps, ctx: CallContext, animal: { id: string; name: string }): string[] {
  const now = isoNow(deps.clock);
  const files: string[] = [];
  for (const row of tx.select().from(animalProposals).where(and(eq(animalProposals.animalId, animal.id), eq(animalProposals.state, 'open'))).all()) {
    tx.update(animalProposals).set({ state: 'rejected', decisionReason: 'animalDeleted', decidedAt: now, updatedAt: now }).where(eq(animalProposals.id, row.id)).run();
    files.push(...releaseImages(tx, row.id));
    recordAudit(tx, deps, ctx, { action: 'animals.proposal.reject', entityType: 'animalProposal', ...proposalAudit(row, animal.name, 'rejected') });
  }
  return files;
}
