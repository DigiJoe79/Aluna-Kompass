import { holdsFor, retentionEnd, retentionMonths, todayIn, type Deps, type DueItem, type RetentionHold } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { documentTypeFor } from './catalog';
import { documentLinks, documents } from './schema';

/**
 * Für entityType === 'contact', 'animal', jede verknüpfte Entität:
 * jedes verknüpfte, festgeschriebene Dokument hält sie.
 */
export function dmsRetentionHolds(deps: Deps, entityType: string, id: string): RetentionHold[] {
  const links = deps.db
    .select()
    .from(documentLinks)
    .where(and(eq(documentLinks.entityType, entityType), eq(documentLinks.entityId, id)))
    .all();

  const holds: RetentionHold[] = [];

  for (const link of links) {
    const doc = deps.db.select().from(documents).where(eq(documents.id, link.documentId)).get();
    if (!doc || doc.phase !== 'issued') continue;

    const docType = documentTypeFor(deps.db, doc.typeKey);
    if (!docType) continue;

    let until: string | null = null;
    if (docType.retentionClass !== 'permanent') {
      const months = retentionMonths(deps, docType.retentionClass);
      if (months !== null) {
        until = retentionEnd(doc.documentDate, months);
      }
    }

    holds.push({
      label: `Dokument ${doc.number ?? doc.subject}`,
      until,
      entity: 'document',
      id: doc.id,
    });
  }

  return holds;
}

/**
 * Festgeschriebene Dokumente, deren eigene Frist abgelaufen ist — und die kein Halter eines Moduls länger hält
 * (Mitglieder: der Aufnahmeantrag bleibt, solange die Mitgliedschaft aufbewahrt wird, Spec Mitglieder § 3.2).
 */
export function dmsRetentionDue(deps: Deps): DueItem[] {
  const today = todayIn(deps);
  const docs = deps.db.select().from(documents).where(eq(documents.phase, 'issued')).all();
  const due: DueItem[] = [];

  for (const doc of docs) {
    const docType = documentTypeFor(deps.db, doc.typeKey);
    if (!docType || docType.retentionClass === 'permanent') continue;

    const months = retentionMonths(deps, docType.retentionClass);
    if (months === null) continue;

    const own = retentionEnd(doc.documentDate, months);
    if (own >= today) continue;
    const held = holdsFor(deps, 'document', doc.id);
    if (held.some((h) => h.until === null)) continue;
    const until = [own, ...held.map((h) => h.until!)].sort().at(-1)!;
    if (until < today) {
      due.push({
        entity: 'document',
        id: doc.id,
        label: `Dokument ${doc.number ?? doc.subject}`,
        dueSince: until,
        href: `/dms/${doc.id}`,
      });
    }
  }

  return due;
}
