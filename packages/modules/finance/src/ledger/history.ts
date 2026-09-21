import { notFound, ok, userNamesFor, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from './access';
import { entryViewInternal } from './entries';
import { financeAllocationCorrections, financeEntryDocuments } from '../schema';

/**
 * Der Verlauf einer Buchung (Spec 5.4/10.5) — aus ihren eigenen Spalten,
 * denen ihrer Korrekturen und Belegzeilen, **nie** aus dem Änderungsprotokoll:
 * Das trägt bewusst keine Texte, und `audit.view` hat die Schatzmeisterin
 * nicht.
 */
export type EntryHistoryEvent =
  | { kind: 'created' | 'reviewed' | 'finalized'; at: string; userName: string | null; channel: 'ui' | 'mcp' | 'system' | null }
  | { kind: 'allocationChanged'; at: string; userName: string | null; correctionId: string; state: 'applied' | 'pending' | 'rejected'; before: unknown; after: unknown; note: string }
  | { kind: 'reversed'; at: string; userName: string | null; byEntryId: string; byNumber: string | null }
  | { kind: 'voucherAdded' | 'voucherRevoked'; at: string; userName: string | null; documentNumber: string };

const idSchema = z.object({ id: z.string().min(1) });

/** `finance.read`; aufsteigend nach `at`. Gelöschte Nutzer erscheinen als `null`. */
export async function getEntryHistory(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ events: EntryHistoryEvent[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const view = entryViewInternal(deps.db, parsed.value.id);
  if (!view) return notFound('financeEntry', parsed.value.id);

  const corrections = deps.db.select().from(financeAllocationCorrections).where(eq(financeAllocationCorrections.entryId, view.id)).all();
  const voucherLinks = deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, view.id)).all();
  const reversal = view.reversedByEntryId ? entryViewInternal(deps.db, view.reversedByEntryId) : null;

  const userIds = [
    view.createdByUserId,
    view.reviewedByUserId,
    view.finalizedByUserId,
    ...corrections.flatMap((c) => [c.requestedByUserId, c.approvedByUserId, c.rejectedByUserId]),
    ...voucherLinks.flatMap((v) => [v.addedByUserId, v.revokedByUserId]),
    reversal?.finalizedByUserId,
  ];
  const names = userNamesFor(deps, userIds);
  const nameOf = (id: string | null | undefined): string | null => (id ? (names.get(id) ?? null) : null);

  const events: EntryHistoryEvent[] = [];
  events.push({ kind: 'created', at: view.createdAt, userName: nameOf(view.createdByUserId), channel: view.createdChannel as 'ui' | 'mcp' | 'system' });
  if (view.reviewedAt) events.push({ kind: 'reviewed', at: view.reviewedAt, userName: nameOf(view.reviewedByUserId), channel: null });
  if (view.finalizedAt) events.push({ kind: 'finalized', at: view.finalizedAt, userName: nameOf(view.finalizedByUserId), channel: view.finalizedChannel as 'ui' | 'mcp' | 'system' | null });

  for (const c of corrections) {
    const state = c.state as 'applied' | 'pending' | 'rejected';
    const at = state === 'applied' ? c.approvedAt! : state === 'rejected' ? c.rejectedAt! : c.requestedAt;
    const userId = state === 'applied' ? c.approvedByUserId : state === 'rejected' ? c.rejectedByUserId : c.requestedByUserId;
    events.push({ kind: 'allocationChanged', at, userName: nameOf(userId), correctionId: c.id, state, before: JSON.parse(c.before) as unknown, after: JSON.parse(c.after) as unknown, note: c.note });
  }

  if (reversal) {
    events.push({ kind: 'reversed', at: reversal.finalizedAt!, userName: nameOf(reversal.finalizedByUserId), byEntryId: reversal.id, byNumber: reversal.number });
  }

  for (const v of voucherLinks) {
    events.push({ kind: 'voucherAdded', at: v.addedAt, userName: nameOf(v.addedByUserId), documentNumber: v.documentNumber });
    if (v.revokedAt) events.push({ kind: 'voucherRevoked', at: v.revokedAt, userName: nameOf(v.revokedByUserId), documentNumber: v.documentNumber });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return ok({ events });
}
