import { and, eq } from 'drizzle-orm';
import { isoNow } from '../clock';
import type { DbOrTx } from '../db/client';
import { moduleProvisions } from '../db/schema';
import type { Deps } from '../deps';

export type ProvisionOutcome = 'created' | 'skipped';
export interface ProvisionKey { module: string; kind: string; key: string }

export function isProvisioned(db: DbOrTx, p: ProvisionKey): boolean {
  return !!db
    .select({ key: moduleProvisions.key })
    .from(moduleProvisions)
    .where(and(eq(moduleProvisions.module, p.module), eq(moduleProvisions.kind, p.kind), eq(moduleProvisions.key, p.key)))
    .get();
}

/**
 * Ruft `create` nur, wenn der Schlüssel noch nie ausgeliefert wurde. Auch
 * `skipped` (Name oder Präfix schon vergeben) gilt als ausgeliefert. Wirft
 * `create`, rollt die Transaktion des Aufrufers beides zurück.
 */
export function provisionOnce(tx: DbOrTx, deps: Deps, p: ProvisionKey, create: () => ProvisionOutcome): ProvisionOutcome | 'already' {
  if (isProvisioned(tx, p)) return 'already';
  const outcome = create();
  tx.insert(moduleProvisions).values({ ...p, outcome, provisionedAt: isoNow(deps.clock) }).run();
  return outcome;
}
