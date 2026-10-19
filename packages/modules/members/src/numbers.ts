import type { DbOrTx } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { memberNumberCounter } from './schema';
import type { MemberNumberFormat } from './settings';

const COUNTER_ID = 'member';

/** Die zuletzt vergebene Nummer (0, solange keine vergeben wurde). */
export function lastMemberNumber(db: DbOrTx): number {
  return db.select().from(memberNumberCounter).where(eq(memberNumberCounter.id, COUNTER_ID)).get()?.last ?? 0;
}

/** Setzt den Zähler; legt seine Zeile beim ersten Mal an. Nur in einer Transaktion eines Dienstes. */
export function setLastMemberNumber(tx: DbOrTx, last: number): void {
  tx.insert(memberNumberCounter).values({ id: COUNTER_ID, last }).onConflictDoUpdate({ target: memberNumberCounter.id, set: { last } }).run();
}

/** Zieht die nächste Nummer — in derselben Transaktion wie die Aufnahme, damit keine doppelt vergeben wird. */
export function drawMemberNumber(tx: DbOrTx): number {
  const next = lastMemberNumber(tx) + 1;
  setLastMemberNumber(tx, next);
  return next;
}

/** `prefix` und die Zahl, links mit Nullen auf `digits` aufgefüllt (`{ prefix: 'M-', digits: 3 }`, 1 → `M-001`). */
export function formatMemberNumber(n: number, fmt: MemberNumberFormat): string {
  return `${fmt.prefix}${String(n).padStart(fmt.digits, '0')}`;
}
