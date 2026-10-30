import { isoNow, newId, recordAudit, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { and, eq, isNull } from 'drizzle-orm';
import { governanceRegisterOccasions, type OccasionRow } from '../schema';

export type OccasionInput = Omit<OccasionRow, 'id' | 'filingId' | 'createdAt'>;

/**
 * Hält einen fälligen Anlass zur Registeranmeldung fest, in der Transaktion des Aufrufers (Spec § 6, § 7.1). Ob er
 * überfällig ist, rechnet G5 aus `occurredOn` und `governance.registerOverdueDays`.
 */
export function recordRegisterOccasionInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: OccasionInput): string {
  const id = newId();
  tx.insert(governanceRegisterOccasions).values({ id, ...input, filingId: null, createdAt: isoNow(deps.clock) }).run();
  recordAudit(tx, deps, ctx, { action: 'governance.registerOccasion.record', entityType: 'governanceRegisterOccasion', entityId: id, after: input, params: { kind: input.kind, occurredOn: input.occurredOn } });
  return id;
}

/** Leere Bezüge — die Aufrufer nennen nur, was sie haben. */
export const occasion = (kind: OccasionRow['kind'], occurredOn: string, refs: Partial<Pick<OccasionRow, 'meetingId' | 'resolutionId' | 'termId' | 'officeId' | 'statuteId'>> = {}): OccasionInput => ({
  kind,
  occurredOn,
  meetingId: refs.meetingId ?? null,
  resolutionId: refs.resolutionId ?? null,
  termId: refs.termId ?? null,
  officeId: refs.officeId ?? null,
  statuteId: refs.statuteId ?? null,
});

/**
 * V-6: Ein Amt schaltet „vertritt“ am selben Tag hin und zurück — der noch offene Anlass `representation` dieses Amts
 * von heute (keiner Anmeldung zugeordnet) entfällt, statt einen zweiten anzulegen. `true`, wenn einer entfallen ist.
 * Ein Anlass in einer Anmeldung bleibt immer.
 */
export function withdrawOpenRepresentationOccasionInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, officeId: string, day: string): boolean {
  const open = tx
    .select()
    .from(governanceRegisterOccasions)
    .where(and(eq(governanceRegisterOccasions.kind, 'representation'), eq(governanceRegisterOccasions.officeId, officeId), eq(governanceRegisterOccasions.occurredOn, day), isNull(governanceRegisterOccasions.filingId)))
    .get();
  if (!open) return false;
  tx.delete(governanceRegisterOccasions).where(eq(governanceRegisterOccasions.id, open.id)).run();
  const { id: _id, filingId: _f, createdAt: _c, ...was } = open;
  recordAudit(tx, deps, ctx, { action: 'governance.registerOccasion.withdraw', entityType: 'governanceRegisterOccasion', entityId: open.id, before: was, params: { kind: open.kind, occurredOn: open.occurredOn } });
  return true;
}
