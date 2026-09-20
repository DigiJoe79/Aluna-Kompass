import { hasPermission, type CallContext, type Deps, type RecordLabel } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { animals } from './schema';

export function animalsRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabel | null {
  if (entityType !== 'animal') return null;
  const row = deps.db.select({ name: animals.name }).from(animals).where(eq(animals.id, id)).get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (!hasPermission(ctx, 'animals.view')) return { label: 'Tier (kein Zugriff)', href: null, state: 'forbidden' };
  return { label: row.name, href: `/animals/${id}`, state: 'ok' };
}
