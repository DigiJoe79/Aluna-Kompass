import { readSetting, type DbOrTx, type Deps } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { inArray } from 'drizzle-orm';
import { memberDunningNotices } from './schema';
import type { DunningLevel } from './settings';

/**
 * Die höchste erreichte Stufe (rein): die höchste, deren Brief einen Versandvermerk trägt — gesetzt von Hand (Post)
 * oder vom Sender, sobald die Mail draußen ist. Ein „nicht zugestellt“ ist kein Vermerk (Handoff 2b E3).
 */
export function reachedLevel(notices: readonly { levelKey: string; documentId: string }[], dispatchOf: (documentId: string) => string | null, levelOrder: readonly string[]): { levelKey: string; sentOn: string } | null {
  let best: { levelKey: string; sentOn: string; index: number } | null = null;
  for (const n of notices) {
    const sentOn = dispatchOf(n.documentId);
    const index = levelOrder.indexOf(n.levelKey);
    if (sentOn === null || index < 0) continue;
    if (!best || index > best.index || (index === best.index && sentOn > best.sentOn)) best = { levelKey: n.levelKey, sentOn, index };
  }
  return best ? { levelKey: best.levelKey, sentOn: best.sentOn } : null;
}

/** Versandtag eines Dokuments (Vereinstag), `null` ohne Vermerk oder storniert. */
export function dispatchMap(db: DbOrTx, documentIds: string[]): Map<string, string | null> {
  if (documentIds.length === 0) return new Map();
  return new Map(db.select({ id: documents.id, sentAt: documents.sentAt, status: documents.status }).from(documents).where(inArray(documents.id, documentIds)).all().map((d) => [d.id, d.status === 'voided' ? null : d.sentAt]));
}

/**
 * Die erreichte Stufe je Beitrag (für `listFees`, Handoff D2): die höchste versandte Stufe eines noch zählenden
 * Vermerks, der den Beitrag nennt. Bezahlt oder erlassen: keine.
 */
export function dunningLevelsOfCharges(db: DbOrTx, deps: Deps, charges: readonly { chargeId: string; membershipId: string; openCents: number; state: string; deferredTo?: string | null }[]): Map<string, string> {
  return dunningLevelsSplit(db, deps, charges).current;
}

/**
 * R17: die Stufe je Beitrag, getrennt nach der Stundung — `current` zählt wie der Mahnlauf nur Vermerke ab der neuen
 * Fälligkeit (E2), `beforeDeferral` die Stufe, die vor der Stundung erreicht war.
 */
export function dunningLevelsSplit(db: DbOrTx, deps: Deps, charges: readonly { chargeId: string; membershipId: string; openCents: number; state: string; deferredTo?: string | null }[]): { current: Map<string, string>; beforeDeferral: Map<string, string> } {
  const open = charges.filter((c) => c.openCents > 0 && c.state !== 'waived');
  const current = new Map<string, string>();
  const beforeDeferral = new Map<string, string>();
  if (open.length === 0) return { current, beforeDeferral };
  const order = readSetting<DunningLevel[]>(deps, 'members.dunningLevels').map((l) => l.key);
  const notices = db.select().from(memberDunningNotices).where(inArray(memberDunningNotices.membershipId, [...new Set(open.map((c) => c.membershipId))])).all();
  const sent = dispatchMap(db, notices.map((n) => n.documentId));
  for (const c of open) {
    const own = notices.filter((n) => n.chargeIds.includes(c.chargeId));
    const deferredTo = c.deferredTo ?? null;
    const reached = reachedLevel(deferredTo ? own.filter((n) => n.issuedOn >= deferredTo) : own, (id) => sent.get(id) ?? null, order);
    if (reached) current.set(c.chargeId, reached.levelKey);
    const before = deferredTo ? reachedLevel(own.filter((n) => n.issuedOn < deferredTo), (id) => sent.get(id) ?? null, order) : null;
    if (before) beforeDeferral.set(c.chargeId, before.levelKey);
  }
  return { current, beforeDeferral };
}

