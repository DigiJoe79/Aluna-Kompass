import type { CallContext, Deps, RecordLabel } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { requireReadable } from './access';
import { documents } from './schema';

export function dmsRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabel | null {
  if (entityType !== 'document') return null;
  const doc = deps.db.select({ number: documents.number, subject: documents.subject, typeKey: documents.typeKey }).from(documents).where(eq(documents.id, id)).get();
  if (!doc) return { label: '', href: null, state: 'missing' };
  if (requireReadable(deps, ctx, doc) !== null) return { label: doc.number ? `${doc.number}, geschützt` : 'Entwurf (geschützt)', href: null, state: 'forbidden' };
  return { label: doc.number ? `${doc.number} · ${doc.subject}` : doc.subject, href: `/dms/${id}`, state: 'ok' };
}
