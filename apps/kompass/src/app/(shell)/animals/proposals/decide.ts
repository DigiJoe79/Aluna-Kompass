import { createFollowUp, ok, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { z } from 'zod';
import { acceptProposal, type PhotoChoice, type ProposalState } from '@kompass/module-animals';

/** Vorab geprüft wie `followUpCreateSchema`: Datum und Notiz (Spec A26). Pfade unter `followUp.`. */
const followUpSchema = z.object({ followUp: z.object({ dueAt: z.string().date(), title: z.string().trim().min(1).max(200) }) });

export interface AcceptRequest {
  id: string;
  fields?: Record<string, 'proposal' | 'current'>;
  values?: Record<string, unknown>;
  photos?: PhotoChoice[];
  publish?: boolean;
  sameAsAnswer?: 'same' | 'different';
  adoptedYear?: number;
  expectedVersion?: string;
  followUp?: { dueAt: string; title: string };
}

/**
 * Annehmen und, wenn gewünscht, danach die Wiedervorlage am Hund (Spec § 6, A26) — zwei Dienste nacheinander, kein
 * dritter Weg. Die Wiedervorlage wird vorher geprüft, damit ein leeres Datum nicht erst nach der Annahme auffällt;
 * lehnt ihr Dienst danach ab (Recht fehlt), bleibt die Annahme stehen und `followUp` sagt `refused`.
 */
export async function acceptWithFollowUp(deps: Deps, ctx: CallContext, input: AcceptRequest): Promise<Result<{ animalId: string | null; state: ProposalState; followUp: 'created' | 'refused' | null }>> {
  const { followUp, ...accept } = input;
  if (followUp) {
    const checked = validate(deps, followUpSchema, { followUp });
    if (!checked.ok) return checked;
  }
  const accepted = await acceptProposal(deps, ctx, accept);
  if (!accepted.ok) return accepted;
  const { animalId, proposal } = accepted.value;
  let filed: 'created' | 'refused' | null = null;
  if (followUp && animalId) {
    const created = await createFollowUp(deps, ctx, { entityType: 'animal', entityId: animalId, dueAt: followUp.dueAt, title: followUp.title.trim() });
    filed = created.ok ? 'created' : 'refused';
  }
  return ok({ animalId, state: proposal.state, followUp: filed });
}
