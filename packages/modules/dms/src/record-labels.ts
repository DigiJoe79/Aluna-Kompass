import type { CallContext, Deps, RecordLabelInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { isProtectedType, requireReadable } from './access';
import { documentTypeFor } from './catalog';
import { documents } from './schema';

export function dmsRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  if (entityType === 'documentDraft') return draftLabel(deps, ctx, id);
  if (entityType !== 'document') return null;
  const doc = deps.db.select({ number: documents.number, subject: documents.subject, typeKey: documents.typeKey }).from(documents).where(eq(documents.id, id)).get();
  if (!doc) return { label: '', href: null, state: 'missing' };
  // `label` hängt vom Aufrufer ab und trägt für den, der lesen darf, den Betreff;
  // das Protokoll nennt das Dokument deshalb über `auditLabel` und hält `sensitive` fest.
  const audit = { sensitive: isProtectedType(documentTypeFor(deps.db, doc.typeKey)), auditLabel: doc.number ?? { key: 'dms.records.draft', params: { id } } };
  if (requireReadable(deps, ctx, doc) !== null) return { label: doc.number ? { key: 'dms.records.protected', params: { number: doc.number } } : { key: 'dms.records.protectedDraft' }, href: null, state: 'forbidden', ...audit };
  // `label` trägt den Trenner für Wiedervorlagen und Verweise; die Spalte „Objekt“ im Protokoll setzt selbst „Dokument · “
  // davor und nimmt deshalb `name` ohne zweiten Trenner (Designer 2026-10-09).
  return { label: doc.number ? `${doc.number} · ${doc.subject}` : doc.subject, name: doc.number ? `${doc.number} ${doc.subject}` : doc.subject, href: `/dms/${id}`, state: 'ok', ...audit };
}

/**
 * Der Entwurf eines Briefs im Protokoll (Joe 2026-10-09): sein Betreff, live und nur für den, der lesen darf, und
 * nie bei einer geschützten Art — der Betreff kann Personen nennen und wird deshalb nie gespeichert.
 */
function draftLabel(deps: Deps, ctx: CallContext, id: string): RecordLabelInput {
  const doc = deps.db.select({ subject: documents.subject, typeKey: documents.typeKey }).from(documents).where(eq(documents.id, id)).get();
  if (!doc) return { label: '', href: null, state: 'missing' };
  if (isProtectedType(documentTypeFor(deps.db, doc.typeKey)) || requireReadable(deps, ctx, doc) !== null) return { label: { key: 'dms.records.protectedDraft' }, href: null, state: 'forbidden' };
  return { label: doc.subject, href: `/dms/${id}`, state: 'ok' };
}
