import { isoNow, newId, ok, requirePermission, schema, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq } from 'drizzle-orm';
import { animalOrigins } from '../schema';

/** Herkunft setzen oder auf dieses Tier umhängen: je Quelle und `externalRef` genau ein Tier (Spec § 2). */
export function upsertOrigin(tx: DbOrTx, deps: Deps, input: { animalId: string; sourceUserId: string; externalRef: string; externalUrl: string | null }): void {
  const now = isoNow(deps.clock);
  tx.insert(animalOrigins)
    .values({ id: newId(), animalId: input.animalId, sourceUserId: input.sourceUserId, externalRef: input.externalRef, externalUrl: input.externalUrl, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [animalOrigins.sourceUserId, animalOrigins.externalRef], set: { animalId: input.animalId, externalUrl: input.externalUrl, updatedAt: now } })
    .run();
}

/** Woher ein Tier stammt, mit dem Namen der Quelle (Dienstnutzer). */
export interface AnimalOrigin {
  sourceUserId: string;
  sourceName: string;
  externalRef: string;
  externalUrl: string | null;
  createdAt: string;
}

export function originsOf(db: DbOrTx, animalId: string): AnimalOrigin[] {
  return db
    .select({ sourceUserId: animalOrigins.sourceUserId, sourceName: schema.users.name, externalRef: animalOrigins.externalRef, externalUrl: animalOrigins.externalUrl, createdAt: animalOrigins.createdAt })
    .from(animalOrigins)
    .innerJoin(schema.users, eq(schema.users.id, animalOrigins.sourceUserId))
    .where(eq(animalOrigins.animalId, animalId))
    .orderBy(asc(schema.users.name), asc(animalOrigins.externalRef))
    .all();
}

/** Herkunft eines Tiers für die Tierseite und MCP (`animals.view`). */
export async function listAnimalOrigins(deps: Deps, ctx: CallContext, animalId: string): Promise<Result<AnimalOrigin[]>> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  return ok(originsOf(deps.db, animalId));
}

/** Tiere mit dieser Kennung bei einer Quelle (Filter `origin` in `listAnimals`). */
export function animalIdsWithOrigin(db: DbOrTx, filter: { externalRef: string; sourceUserId?: string }): Set<string> {
  const rows = db
    .select({ animalId: animalOrigins.animalId })
    .from(animalOrigins)
    .where(and(eq(animalOrigins.externalRef, filter.externalRef), filter.sourceUserId ? eq(animalOrigins.sourceUserId, filter.sourceUserId) : undefined))
    .all();
  return new Set(rows.map((r) => r.animalId));
}
