import { retentionEnd, retentionMonths, type Deps, type DbOrTx, type RetentionHold } from '@kompass/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  financeAllocationCorrections,
  financeAllocationLines,
  financeEntries,
  financeEntryDocuments,
  financeFiscalYears,
  financeOpenItems,
  financePeriodEvents,
  type FinanceEntryRow,
} from '../schema';
import { fiscalYearForInternal, fiscalYearStatusInternal } from './fiscal-years';

/**
 * Der Anker, ab dem die Frist eines Geschäftsjahres läuft: der spätere aus
 * seinem jüngsten Abschluss-Ereignis und dem jüngsten Vorgang an seinen
 * Zeilen (`finalizedAt` der Buchungen, `approvedAt`/`requestedAt` angewandter
 * Korrekturen). `null`, solange das Jahr derzeit offen ist — nie
 * abgeschlossen oder wieder geöffnet (Spec 10.3, F2c Task 5).
 */
export function yearAnchorInternal(db: DbOrTx, fiscalYearId: string): string | null {
  if (fiscalYearStatusInternal(db, fiscalYearId) !== 'closed') return null;
  const latestClose = db
    .select()
    .from(financePeriodEvents)
    .where(and(eq(financePeriodEvents.fiscalYearId, fiscalYearId), eq(financePeriodEvents.kind, 'closed')))
    .orderBy(desc(financePeriodEvents.at))
    .limit(1)
    .get()!;
  let anchor = latestClose.at;

  const entries = db.select({ id: financeEntries.id, finalizedAt: financeEntries.finalizedAt }).from(financeEntries).where(eq(financeEntries.fiscalYearId, fiscalYearId)).all();
  for (const entry of entries) {
    if (entry.finalizedAt && entry.finalizedAt > anchor) anchor = entry.finalizedAt;
  }

  const entryIds = entries.map((e) => e.id);
  if (entryIds.length > 0) {
    const corrections = db.select().from(financeAllocationCorrections).where(inArray(financeAllocationCorrections.entryId, entryIds)).all();
    for (const correction of corrections) {
      const at = correction.approvedAt ?? correction.requestedAt;
      if (at && at > anchor) anchor = at;
    }
  }
  return anchor;
}

/** `statutory10Y` ab dem Anker des Jahres — `null` (dauerhaft), solange das Jahr offen ist. */
function contactHoldUntil(deps: Deps, fiscalYearId: string | null): string | null {
  if (!fiscalYearId) return null;
  const anchor = yearAnchorInternal(deps.db, fiscalYearId);
  if (anchor === null) return null;
  const months = retentionMonths(deps, 'statutory10Y');
  return months === null ? null : retentionEnd(anchor, months);
}

/** Ende des Geschäftsjahres der Buchung — `statutory8Y` ab dort, für Belege. */
function entryDocumentHoldUntil(deps: Deps, entry: Pick<FinanceEntryRow, 'fiscalYearId'>): string | null {
  if (!entry.fiscalYearId) return null;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, entry.fiscalYearId)).get();
  if (!year) return null;
  const months = retentionMonths(deps, 'statutory8Y');
  return months === null ? null : retentionEnd(year.endsOn, months);
}

/** Für einen offenen Posten: das Geschäftsjahr, das seinen Stichtag deckt, sonst der Stichtag selbst. */
function openItemHoldUntil(deps: Deps, itemDate: string): string | null {
  const months = retentionMonths(deps, 'statutory8Y');
  if (months === null) return null;
  const year = fiscalYearForInternal(deps.db, itemDate);
  return retentionEnd(year ? year.endsOn : itemDate, months);
}

/** Kontakt: ein Halter je Buchung — nie je Zeile, nie mit Text. */
function contactHolds(deps: Deps, contactId: string): RetentionHold[] {
  const lines = deps.db
    .select({ entryId: financeAllocationLines.entryId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(eq(financeAllocationLines.contactId, contactId), eq(financeEntries.status, 'final')))
    .all();
  const entryIds = [...new Set(lines.map((l) => l.entryId))];
  const holds: RetentionHold[] = [];
  for (const entryId of entryIds) {
    const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, entryId)).get()!;
    holds.push({ label: `Buchung ${entry.number ?? entry.id}`, until: contactHoldUntil(deps, entry.fiscalYearId), entity: 'financeEntry', id: entry.id });
  }

  const openItems = deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.contactId, contactId)).all();
  for (const item of openItems) {
    holds.push({ label: `Offener Posten ${item.id}`, until: openItemHoldUntil(deps, item.itemDate), entity: 'financeOpenItem', id: item.id });
  }
  return holds;
}

/**
 * Dokument als Beleg: solange festgeschrieben — auch widerrufen —, am
 * offenen Posten, als Nachweis einer Korrektur. Belege an Entwürfen halten
 * nicht (sie sind Verweise, Task 6).
 */
function documentHolds(deps: Deps, documentId: string): RetentionHold[] {
  const holds: RetentionHold[] = [];
  const links = deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.documentId, documentId)).all();
  for (const link of links) {
    const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, link.entryId)).get();
    if (!entry || entry.status !== 'final') continue;
    holds.push({ label: `Buchung ${entry.number ?? entry.id}`, until: entryDocumentHoldUntil(deps, entry), entity: 'financeEntry', id: entry.id });
  }

  const openItems = deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.documentId, documentId)).all();
  for (const item of openItems) {
    holds.push({ label: `Offener Posten ${item.id}`, until: openItemHoldUntil(deps, item.itemDate), entity: 'financeOpenItem', id: item.id });
  }

  const corrections = deps.db.select().from(financeAllocationCorrections).where(eq(financeAllocationCorrections.proofDocumentId, documentId)).all();
  for (const correction of corrections) {
    const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, correction.entryId)).get();
    if (!entry) continue;
    holds.push({ label: `Buchung ${entry.number ?? entry.id}`, until: entryDocumentHoldUntil(deps, entry), entity: 'financeEntry', id: entry.id });
  }
  return holds;
}

/** Projekt: ein Halter je Buchung, solange eine festgeschriebene Zeile darauf zeigt — dauerhaft. */
function projectHolds(deps: Deps, projectId: string): RetentionHold[] {
  const lines = deps.db
    .select({ entryId: financeAllocationLines.entryId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(eq(financeAllocationLines.projectId, projectId), eq(financeEntries.status, 'final')))
    .all();
  const entryIds = [...new Set(lines.map((l) => l.entryId))];
  return entryIds.map((entryId) => {
    const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, entryId)).get()!;
    return { label: `Buchung ${entry.number ?? entry.id}`, until: null, entity: 'financeEntry', id: entry.id };
  });
}

/**
 * Was Finanzen festhält (Spec 10.3) — synchron, nur lesend, ohne
 * Rechteprüfung. Antwortet nur für die Entitätstypen, die es kennt: Für
 * jeden anderen `entityType` wird gar nicht erst abgefragt, deshalb wirft
 * diese Funktion nie.
 */
export function financeRetentionHolds(deps: Deps, entityType: string, id: string): RetentionHold[] {
  if (entityType === 'contact') return contactHolds(deps, id);
  if (entityType === 'document') return documentHolds(deps, id);
  if (entityType === 'project') return projectHolds(deps, id);
  return [];
}
