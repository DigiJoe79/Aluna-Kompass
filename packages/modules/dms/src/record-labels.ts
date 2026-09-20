import type { CallContext, Deps, RecordLabel } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { isProtectedType, requireReadable } from './access';
import { documentTypeFor } from './catalog';
import { documents } from './schema';

export function dmsRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabel | null {
  if (entityType !== 'document') return null;
  const doc = deps.db.select({ number: documents.number, subject: documents.subject, typeKey: documents.typeKey }).from(documents).where(eq(documents.id, id)).get();
  if (!doc) return { label: '', href: null, state: 'missing' };
  // `label` hängt vom Aufrufer ab und trägt für den, der lesen darf, den Betreff;
  // das Protokoll nennt das Dokument deshalb über `auditLabel` und hält `sensitive` fest.
  const audit = { sensitive: isProtectedType(documentTypeFor(deps.db, doc.typeKey)), auditLabel: doc.number ?? `Entwurf ${id}` };
  if (requireReadable(deps, ctx, doc) !== null) return { label: doc.number ? `${doc.number}, geschützt` : 'Entwurf (geschützt)', href: null, state: 'forbidden', ...audit };
  return { label: doc.number ? `${doc.number} · ${doc.subject}` : doc.subject, href: `/dms/${id}`, state: 'ok', ...audit };
}
