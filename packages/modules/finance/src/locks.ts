import type { CallContext, DbOrTx, Deps } from '@kompass/core';

/**
 * Statische Arrays, kein Laufzeit-Register: Next lädt Module je Route-Bundle
 * neu, ein Register trüge nicht (Spec 4.1). Gefüllt ab F6a
 * (`donations/locks.ts` „Zeile steht in gültiger Bestätigung“) und F9a
 * (`reporting/locks.ts`).
 *
 * Wer die Sperren einträgt, ist `manifest.ts` (Verdrahtung): `ledger/` kennt
 * `donations/` nicht. Weil jedes Bundle, das einen Dienst des Moduls lädt, über
 * `index.ts` auch das Manifest lädt, steht die Liste in jedem Bundle, bevor
 * ein Dienst sie liest — und `registerEntryLocks` ist idempotent, damit ein
 * zweites Laden nichts verdoppelt.
 */
export type EntryLock = (db: DbOrTx, entryId: string) => { scope: 'entry' | 'contact'; reason: string } | null;
export interface PeriodReopenGuard { describe(db: DbOrTx, yearId: string): string | null; onReopen(tx: DbOrTx, deps: Deps, ctx: CallContext, yearId: string, reason: string): void }

const entryLocks: EntryLock[] = [];

export const ENTRY_LOCKS: readonly EntryLock[] = entryLocks;
export const PERIOD_REOPEN_GUARDS: readonly PeriodReopenGuard[] = [];

/** Trägt Sperren in `ENTRY_LOCKS` ein — jede höchstens einmal. */
export function registerEntryLocks(locks: readonly EntryLock[]): void {
  for (const lock of locks) if (!entryLocks.includes(lock)) entryLocks.push(lock);
}
