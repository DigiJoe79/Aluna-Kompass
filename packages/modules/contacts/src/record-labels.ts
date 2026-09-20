import { hasPermission, type CallContext, type Deps, type RecordLabel } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { displayName } from './address';
import { contacts } from './schema';

export function contactsRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabel | null {
  if (entityType !== 'contact') return null;
  const row = deps.db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (!hasPermission(ctx, 'contacts.view')) return { label: 'Kontakt (kein Zugriff)', href: null, state: 'forbidden' };
  return { label: displayName(row), href: `/contacts/${id}`, state: 'ok' };
}
