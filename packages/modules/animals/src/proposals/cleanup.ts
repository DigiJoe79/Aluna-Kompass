import { recordAudit, systemContext, type Deps } from '@kompass/core';
import { and, eq, inArray, isNull, lt, ne } from 'drizzle-orm';
import { animalProposalImages, animalProposals } from '../schema';
import { deleteDecidedProposalFiles } from './decide';
import { deleteProposalFiles, STAGED_IMAGE_TTL_MS } from './images';

/** Nach so vielen Tagen ab der Entscheidung bleiben nur Zustand, Zeitpunkt und Grund (Spec § 1, A39). */
export const PROPOSAL_CONTENT_RETENTION_DAYS = 90;

/** Spec § 7: bereitgestellt ohne Vorschlag nach 24 h; Dateien entschiedener Vorschläge sofort (Nachlese); Inhalte 90 Tage nach der Entscheidung. */
export async function sweepProposals(deps: Deps): Promise<{ stagedRemoved: number; filesRemoved: number; cleared: number }> {
  const now = deps.clock.now();
  const ctx = systemContext({ permissions: ['animals.manage'] });
  const stagedBefore = new Date(now.getTime() - STAGED_IMAGE_TTL_MS).toISOString();
  const clearBefore = new Date(now.getTime() - PROPOSAL_CONTENT_RETENTION_DAYS * 86_400_000).toISOString();
  const staged = deps.db
    .select({ id: animalProposalImages.id, filename: animalProposalImages.filename })
    .from(animalProposalImages)
    .where(and(isNull(animalProposalImages.proposalId), lt(animalProposalImages.createdAt, stagedBefore)))
    .all();
  const filesRemoved = await deleteDecidedProposalFiles(deps);
  const due = deps.db
    .select({ id: animalProposals.id })
    .from(animalProposals)
    .where(and(ne(animalProposals.state, 'open'), isNull(animalProposals.clearedAt), lt(animalProposals.decidedAt, clearBefore)))
    .all();
  if (staged.length === 0 && due.length === 0 && filesRemoved === 0) return { stagedRemoved: 0, filesRemoved: 0, cleared: 0 };
  // Erst die Zeilen, dann die Dateien, und nur Zeilen, die noch an keinem Vorschlag hängen: Ein Einreichen kurz vor
  // Ablauf der 24 Stunden behält sein Bild. Bricht der Lauf danach ab, bleibt höchstens eine Datei ohne Zeile.
  const removed = deps.db.transaction((tx) => {
    const gone = staged.length
      ? tx.delete(animalProposalImages).where(and(inArray(animalProposalImages.id, staged.map((s) => s.id)), isNull(animalProposalImages.proposalId))).returning({ filename: animalProposalImages.filename }).all()
      : [];
    for (const { id } of due) {
      tx.delete(animalProposalImages).where(eq(animalProposalImages.proposalId, id)).run();
      // `updatedAt` mit, damit der Rückkanal mit `since` das Leeren sieht.
      tx.update(animalProposals).set({ values: null, hints: null, baseline: null, final: null, clearedAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(animalProposals.id, id)).run();
    }
    recordAudit(tx, deps, ctx, { action: 'animals.proposal.clear', entityType: 'animalProposal', entityId: null, params: { proposals: due.length, images: gone.length + filesRemoved } });
    return gone;
  });
  await deleteProposalFiles(deps, removed.flatMap((r) => (r.filename ? [r.filename] : [])));
  return { stagedRemoved: removed.length, filesRemoved, cleared: due.length };
}
