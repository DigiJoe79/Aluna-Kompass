import { hasPermission, type CallContext, type Deps, type RecordLabelInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { proposalName } from './proposals/model';
import { animalProposals, animals } from './schema';

export function animalsRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  if (entityType === 'animalProposal') return proposalLabel(deps, ctx, id);
  if (entityType !== 'animal') return null;
  const row = deps.db.select({ name: animals.name }).from(animals).where(eq(animals.id, id)).get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (!hasPermission(ctx, 'animals.view')) return { label: { key: 'animals.records.forbidden' }, href: null, state: 'forbidden' };
  return { label: row.name, href: `/animals/${id}`, state: 'ok' };
}

/** Ein Vorschlag (Protokoll, Wiedervorlage): sehen darf ihn nur, wer die Inbox sieht (`animals.manage`). Die Prüfseite kommt mit Plan B. */
function proposalLabel(deps: Deps, ctx: CallContext, id: string): RecordLabelInput {
  const row = deps.db.select({ kind: animalProposals.kind, values: animalProposals.values, animalId: animalProposals.animalId }).from(animalProposals).where(eq(animalProposals.id, id)).get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (!hasPermission(ctx, 'animals.manage')) return { label: { key: 'animals.records.forbidden' }, href: null, state: 'forbidden' };
  const animal = row.animalId ? (deps.db.select({ name: animals.name }).from(animals).where(eq(animals.id, row.animalId)).get() ?? null) : null;
  const name = proposalName(row, animal);
  return { label: { key: 'animals.records.proposal', params: { name } }, name, href: `/animals/proposals/${id}`, state: 'ok' };
}
