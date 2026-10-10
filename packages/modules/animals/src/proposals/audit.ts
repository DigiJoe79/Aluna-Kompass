import type { DbOrTx } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { animalProposalImages, type ProposalKind, type ProposalState } from '../schema';
import type { ProposalRow } from './model';

/*
 * Bausteine der Vorschlagsdienste ohne Abhängigkeit von `service.ts` — auch `deleteAnimal` nutzt sie (kein Importkreis).
 */

/**
 * Vorschlags-Einträge im Protokoll: Zustand und Art, nie Inhalte (das Protokoll ist unlöschbar, die Inhalte werden
 * nach 90 Tagen geleert). `from = null` (Einreichen) lässt `before` weg. Den Typ `entityType: 'animalProposal'`
 * schreibt jeder Aufruf selbst als festen Text (Wächter audit-actions).
 */
export function proposalAudit(
  p: Pick<ProposalRow, 'id' | 'kind' | 'animalId' | 'sourceKey'>,
  name: string,
  to: ProposalState,
  from: ProposalState | null = 'open',
): { entityId: string; before?: { state: ProposalState }; after: { state: ProposalState; kind: ProposalKind; animalId: string | null }; params: { kind: ProposalKind; name: string; sourceKey: string } } {
  return {
    entityId: p.id,
    ...(from === null ? {} : { before: { state: from } }),
    after: { state: to, kind: p.kind, animalId: p.animalId },
    params: { kind: p.kind, name, sourceKey: p.sourceKey },
  };
}

/** Setzt die Dateinamen der Bilder eines Vorschlags auf `null` und gibt sie zum Löschen nach der Transaktion zurück. */
export function releaseImages(tx: DbOrTx, proposalId: string): string[] {
  const rows = tx.select({ id: animalProposalImages.id, filename: animalProposalImages.filename }).from(animalProposalImages).where(eq(animalProposalImages.proposalId, proposalId)).all();
  const files = rows.flatMap((r) => (r.filename ? [r.filename] : []));
  if (files.length) tx.update(animalProposalImages).set({ filename: null }).where(eq(animalProposalImages.proposalId, proposalId)).run();
  return files;
}

