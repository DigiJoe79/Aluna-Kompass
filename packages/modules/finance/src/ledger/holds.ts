import { isoNow, retentionEnd, retentionMonths, type CallContext, type Deps, type DbOrTx, type DueItem, type RecordReference, type RetentionHold } from '@kompass/core';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { financeAudit } from '../audit';
import {
  financeAllocationCorrections,
  financeAllocationLines,
  financeCashCounts,
  financeEntries,
  financeEntryDocuments,
  financeFiscalYears,
  financeOpenItems,
  financePeriodEvents,
  financeProjectSettings,
  financePurposes,
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

  // Wem der Verein Geld anvertraut, den führt er als Kontakt (Entschieden 1, F3b Task 1) — derselbe Anker wie eine Buchungszeile.
  const counts = deps.db.select().from(financeCashCounts).where(or(eq(financeCashCounts.counterOneContactId, contactId), eq(financeCashCounts.counterTwoContactId, contactId))).all();
  for (const count of counts) {
    const fiscalYearId = fiscalYearForInternal(deps.db, count.countedOn)?.id ?? null;
    holds.push({ label: `Kassenzählung ${count.documentNumber}`, until: contactHoldUntil(deps, fiscalYearId), entity: 'financeCashCount', id: count.id });
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

/** Ob irgendein Halter aus `financeRetentionHolds` gerade läuft (dauerhaft oder bis mindestens heute). */
function anyHoldRunning(deps: Deps, entityType: string, id: string): boolean {
  const today = isoNow(deps.clock).slice(0, 10);
  return financeRetentionHolds(deps, entityType, id).some((h) => h.until === null || h.until >= today);
}

/**
 * Projekt: solange eine Zeile — auch eines Entwurfs — oder ein Zweck darauf
 * zeigt. Die Finanzfelder des Projekts sind kein Verweis (die räumt
 * `recordDeleted` mit, ab F2c Task 7 — dort entsteht die Tabelle).
 */
function projectReferences(deps: Deps, projectId: string): RecordReference[] {
  const lines = deps.db.select({ entryId: financeAllocationLines.entryId }).from(financeAllocationLines).where(eq(financeAllocationLines.projectId, projectId)).all();
  const entryIds = [...new Set(lines.map((l) => l.entryId))];
  const refs: RecordReference[] = entryIds.map((entryId) => {
    const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, entryId)).get()!;
    return { label: `Buchung ${entry.number ?? entry.id}`, entity: 'financeEntry', id: entry.id };
  });
  const purposes = deps.db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.projectId, projectId)).all();
  for (const purpose of purposes) refs.push({ label: `Zweck ${purpose.id}`, entity: 'financePurpose', id: purpose.id });
  return refs;
}

/**
 * Dokument: solange der Halter läuft, oder solange es an einem Entwurf
 * hängt. Mit dem Halter endet der Verweis — sonst wäre ein Beleg nie
 * löschbar (Spec 10.3).
 */
function documentReferences(deps: Deps, documentId: string): RecordReference[] {
  const refs: RecordReference[] = [];
  if (anyHoldRunning(deps, 'document', documentId)) {
    refs.push({ label: 'Beleg (Halter läuft)', entity: 'financeEntryDocument', id: documentId });
  }
  const draftLinks = deps.db
    .select({ entryId: financeEntryDocuments.entryId })
    .from(financeEntryDocuments)
    .innerJoin(financeEntries, eq(financeEntryDocuments.entryId, financeEntries.id))
    .where(and(eq(financeEntryDocuments.documentId, documentId), eq(financeEntries.status, 'draft')))
    .all();
  for (const link of draftLinks) refs.push({ label: `Buchungsentwurf ${link.entryId}`, entity: 'financeEntry', id: link.entryId });
  return refs;
}

/**
 * Wo Finanzen auf einen fremden Datensatz zeigt (Spec 10.3). Für Kontakte
 * nie — dort zählen nur Halter (V7); ohne Rechteprüfung, wirft nie.
 */
export function financeRecordReferences(deps: Deps, entityType: string, id: string): RecordReference[] {
  if (entityType === 'project') return projectReferences(deps, id);
  if (entityType === 'document') return documentReferences(deps, id);
  return [];
}

/** Nur Zählwerte und IDs (Spec 10.3) — nie ein Dokumenttitel. */
function documentGoneAuditFields(entryId: string): Record<string, unknown> {
  return { entryId, linkCount: 1 };
}

/**
 * Ein Dokument wurde gelöscht: Der Bezug bleibt als Grabstein (Nummer,
 * Prüfsumme), nur `documentId` wird geleert — sonst wäre ein einmal
 * verknüpfter Beleg nach seiner Frist nie aufräumbar. Ebenso an offenen
 * Posten und an Korrekturen. Andere Entitätstypen: kein Vorgang von
 * Finanzen, also nichts zu tun.
 */
export function financeRecordDeleted(tx: DbOrTx, deps: Deps, ctx: CallContext, entityType: string, id: string): void {
  if (entityType === 'document') {
    const now = isoNow(deps.clock);
    const links = tx.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.documentId, id)).all();
    for (const link of links) {
      tx.update(financeEntryDocuments).set({ documentId: null, documentDeletedAt: now }).where(eq(financeEntryDocuments.id, link.id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.entry.documentGone', entity: 'financeEntry', id: link.entryId, after: documentGoneAuditFields(link.entryId), summary: `Beleg an Buchung ${link.entryId} entfernt` });
    }
    tx.update(financeOpenItems).set({ documentId: null }).where(eq(financeOpenItems.documentId, id)).run();
    tx.update(financeAllocationCorrections).set({ proofDocumentId: null }).where(eq(financeAllocationCorrections.proofDocumentId, id)).run();
    // Ein Zählprotokoll behält Nummer und Prüfsumme als Grabstein (Muster financeEntryDocuments) — nur die Dokument-ID verschwindet.
    tx.update(financeCashCounts).set({ documentId: null }).where(eq(financeCashCounts.documentId, id)).run();
    return;
  }
  if (entityType === 'project') {
    // Die Finanzfelder eines Projekts sind kein Verweis (Task 6) — ohne Buchung geht das Projekt frei; seine Zeile räumt sich mit.
    const settings = tx.select().from(financeProjectSettings).where(eq(financeProjectSettings.projectId, id)).get();
    if (!settings) return;
    tx.delete(financeProjectSettings).where(eq(financeProjectSettings.projectId, id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.projectSettings.delete', entity: 'financeProjectSettings', id, before: settings, summary: `Finanzfelder von Projekt ${id} gelöscht` });
    return;
  }
}

/**
 * Je abgeschlossenem Geschäftsjahr, dessen Anker plus zehn Jahre abgelaufen
 * ist: ein Posten für den Fristenbildschirm — ohne `href`, der Dienst, der
 * anonymisiert, kommt erst nach 0.2.0 (Spec 10.3).
 */
export function financeRetentionDue(deps: Deps): DueItem[] {
  const today = isoNow(deps.clock).slice(0, 10);
  const months = retentionMonths(deps, 'statutory10Y');
  if (months === null) return [];
  const due: DueItem[] = [];
  for (const year of deps.db.select().from(financeFiscalYears).all()) {
    if (fiscalYearStatusInternal(deps.db, year.id) !== 'closed') continue;
    const anchor = yearAnchorInternal(deps.db, year.id);
    if (anchor === null) continue;
    const dueSince = retentionEnd(anchor, months);
    if (dueSince < today) due.push({ entity: 'financeYearPersonalData', id: year.id, label: `Finanzen ${year.designation}: personenbezogene Inhalte`, dueSince });
  }
  return due;
}
