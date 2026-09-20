import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import type { Deps } from '../deps';
import { enabledManifests } from './service';

/** Nach dem Löschen eines Datensatzes, in derselben Transaktion. Wirft ein Haken, rollt alles zurück. */
export function notifyRecordDeleted(tx: DbOrTx, deps: Deps, ctx: CallContext, entityType: string, id: string): void {
  for (const manifest of enabledManifests(deps)) manifest.recordDeleted?.(tx, deps, ctx, entityType, id);
}
