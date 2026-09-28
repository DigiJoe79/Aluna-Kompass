import { hasPermission, type CallContext, type Deps, type RecordLabelInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { displayName } from './address';
import { contacts } from './schema';

export function contactsRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  if (entityType !== 'contact') return null;
  const row = deps.db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (!hasPermission(ctx, 'contacts.view')) return { label: { key: 'contacts.records.forbidden' }, href: null, state: 'forbidden' };
  return { label: displayName(row), href: `/contacts/${id}`, state: 'ok' };
}
