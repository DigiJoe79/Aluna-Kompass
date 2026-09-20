import type { CallContext, DbOrTx, Deps } from '@kompass/core';

/**
 * Statische Arrays, kein Laufzeit-Register: Next lädt Module je Route-Bundle
 * neu, ein Register trüge nicht (Spec 4.1). Gefüllt ab F2b (`donations/locks.ts`
 * „Zeile steht in gültiger Bestätigung“) und F9a (`reporting/locks.ts`).
 */
export type EntryLock = (db: DbOrTx, entryId: string) => { scope: 'entry' | 'contact'; reason: string } | null;
export interface PeriodReopenGuard { describe(db: DbOrTx, yearId: string): string | null; onReopen(tx: DbOrTx, deps: Deps, ctx: CallContext, yearId: string, reason: string): void }

export const ENTRY_LOCKS: readonly EntryLock[] = [];
export const PERIOD_REOPEN_GUARDS: readonly PeriodReopenGuard[] = [];
