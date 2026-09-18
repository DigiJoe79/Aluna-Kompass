import {
  retentionEnd,
  retentionMonths,
  type Deps,
  type DueItem,
  type RetentionHold,
} from '@kompass/core';
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
 * Festgeschriebene Dokumente, deren eigene Frist abgelaufen ist.
 */
export function dmsRetentionDue(deps: Deps): DueItem[] {
  const today = deps.clock.now().toISOString().slice(0, 10);
  const docs = deps.db.select().from(documents).where(eq(documents.phase, 'issued')).all();
  const due: DueItem[] = [];

  for (const doc of docs) {
    const docType = documentTypeFor(deps.db, doc.typeKey);
    if (!docType || docType.retentionClass === 'permanent') continue;

    const months = retentionMonths(deps, docType.retentionClass);
    if (months === null) continue;

    const until = retentionEnd(doc.documentDate, months);
    if (until < today) {
      due.push({
        entity: 'document',
        id: doc.id,
        label: `Dokument ${doc.number ?? doc.subject}`,
        dueSince: until,
      });
    }
  }

  return due;
}
