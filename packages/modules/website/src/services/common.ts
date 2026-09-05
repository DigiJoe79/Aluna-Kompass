import { schema as core, type DbOrTx } from '@kompass/core';
import { eq, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function nextSortOrder(db: DbOrTx, table: SQLiteTable, column: SQLiteColumn): number {
  const row = db.select({ n: sql<number>`coalesce(max(${column}), 0)` }).from(table).get();
  return (row?.n ?? 0) + 1;
}

export function assetMime(db: DbOrTx, id: string | null | undefined): string | null | undefined {
  if (id === null || id === undefined) return id;
  return db.select({ mime: core.mediaAssets.mimeType }).from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get()?.mime ?? null;
}
