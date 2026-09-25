import { isoNow, retentionEnd, retentionMonths, schema, type CallContext, type Deps, type DbOrTx, type DueItem, type RecordReference, type RetentionHold } from '@kompass/core';
import { documentLinks } from '@kompass/module-dms';
import { and, desc, eq, gte, inArray, lte, ne, or, type SQL } from 'drizzle-orm';
import { financeAudit } from '../audit';
import {
  financeAllocationCorrections,
  financeAllocationLines,
  financeCashCounts,
  financeConfirmations,
  financeContactBankAccounts,
  financeContactWaiverTerms,
  financeEntries,
  financeEntryDocuments,
  financeExpenseClaims,
  financeExpensePositions,
  financeFiscalYears,
  financeInKindDetails,
  financeNotices,
  financeOpenItems,
  financePeriodEvents,
  financeProjectSettings,
  financePurposes,
  financeRawTransactions,
  type FinanceEntryRow,
  type FinanceExpenseClaimRow,
  type FinanceFiscalYearRow,
} from '../schema';
import { fiscalYearForInternal, fiscalYearStatusInternal } from './fiscal-years';
import { noticeValidUntil } from './notice-validity';

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

/** `statutory10Y` ab Ende des Kalenderjahres von `fromDate` — für Dokumente der Spenden (F6a). */
function tenYearsFrom(deps: Deps, fromDate: string): string | null {
  const months = retentionMonths(deps, 'statutory10Y');
  return months === null ? null : retentionEnd(fromDate, months);
}

/**
 * F8a: Ein Antrag hält ab dem Einreichen, ab Ende des Jahres seiner Nummer
 * (= Jahr des Einreichens, Annahme 1). Ein Entwurf hält nie — er ist Arbeitsmaterial.
 */
function claimHoldUntil(deps: Deps, claim: FinanceExpenseClaimRow, retentionClass: 'statutory8Y' | 'statutory10Y'): string | null {
  const months = retentionMonths(deps, retentionClass);
  return months === null || !claim.submittedAt ? null : retentionEnd(claim.submittedAt, months);
}

/** Die Beschriftung eines Antrags in Haltern und Verweisen: die Nummer, im Entwurf die ID — nie die Person. */
function claimLabel(claim: Pick<FinanceExpenseClaimRow, 'id' | 'number'>): string {
  return claim.number ? `Antrag ${claim.number}` : `Auslage (Entwurf) ${claim.id}`;
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

  // F6a: je Bestätigung ein Halter — wie je Buchung, mit dem Anker des Geschäftsjahres des Ausstellungstags.
  const confirmations = deps.db.select().from(financeConfirmations).where(eq(financeConfirmations.contactId, contactId)).all();
  for (const confirmation of confirmations) {
    const fiscalYearId = fiscalYearForInternal(deps.db, confirmation.issuedOn)?.id ?? null;
    holds.push({ label: `Bestätigung ${confirmation.documentNumber}`, until: contactHoldUntil(deps, fiscalYearId), entity: 'financeConfirmation', id: confirmation.id });
  }

  // F8a: je eingereichtem Antrag ein Halter — zehn Jahre ab Ende des Jahres seiner Nummer.
  const claims = deps.db.select().from(financeExpenseClaims).where(and(eq(financeExpenseClaims.contactId, contactId), ne(financeExpenseClaims.state, 'draft'))).all();
  for (const claim of claims) holds.push({ label: claimLabel(claim), until: claimHoldUntil(deps, claim, 'statutory10Y'), entity: 'financeExpenseClaim', id: claim.id });
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

  // F6a: unser Exemplar und die unterschriebene Fassung — zehn Jahre ab Ende des Ausstellungsjahres.
  const confirmations = deps.db.select().from(financeConfirmations).where(or(eq(financeConfirmations.documentId, documentId), eq(financeConfirmations.signedDocumentId, documentId))).all();
  for (const confirmation of confirmations) {
    holds.push({ label: `Bestätigung ${confirmation.documentNumber}`, until: tenYearsFrom(deps, confirmation.issuedOn), entity: 'financeConfirmation', id: confirmation.id });
  }

  // Der Bescheid und sein Aufhebungs- oder Ersetzungsbescheid — zehn Jahre ab Ende seiner Gültigkeit (auch, wenn er früher ersetzt wurde).
  const notices = deps.db.select().from(financeNotices).where(or(eq(financeNotices.documentId, documentId), eq(financeNotices.supersededDocumentId, documentId))).all();
  for (const notice of notices) {
    holds.push({ label: `Bescheid vom ${notice.noticeDate}`, until: tenYearsFrom(deps, noticeValidUntil(notice.kind, notice.noticeDate)), entity: 'financeNotice', id: notice.id });
  }

  // Die Wertunterlage einer Sachspende — zehn Jahre ab Ende des Geschäftsjahres ihrer Buchung.
  const inKind = deps.db
    .select({ entryId: financeAllocationLines.entryId })
    .from(financeInKindDetails)
    .innerJoin(financeAllocationLines, eq(financeInKindDetails.lineId, financeAllocationLines.id))
    .where(eq(financeInKindDetails.proofDocumentId, documentId))
    .all();
  for (const entryId of new Set(inKind.map((r) => r.entryId))) {
    const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, entryId)).get();
    if (!entry) continue;
    const year = entry.fiscalYearId ? deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, entry.fiscalYearId)).get() : undefined;
    holds.push({ label: `Buchung ${entry.number ?? entry.id}`, until: tenYearsFrom(deps, year?.endsOn ?? entry.entryDate), entity: 'financeEntry', id: entry.id });
  }

  // F8a: Belege eingereichter Anträge acht Jahre, Verzichtserklärung und unterschriebene Fassung zehn — ab Ende des Jahres der Nummer.
  const receiptClaimIds = deps.db.select({ claimId: financeExpensePositions.claimId }).from(financeExpensePositions).where(eq(financeExpensePositions.documentId, documentId)).all().map((r) => r.claimId);
  for (const claimId of new Set(receiptClaimIds)) {
    const claim = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claimId)).get();
    if (!claim || claim.state === 'draft') continue;
    holds.push({ label: claimLabel(claim), until: claimHoldUntil(deps, claim, 'statutory8Y'), entity: 'financeExpenseClaim', id: claim.id });
  }
  const waiverClaims = deps.db
    .select()
    .from(financeExpenseClaims)
    .where(and(ne(financeExpenseClaims.state, 'draft'), or(eq(financeExpenseClaims.waiverDeclarationDocumentId, documentId), eq(financeExpenseClaims.waiverSignedDocumentId, documentId))))
    .all();
  for (const claim of waiverClaims) holds.push({ label: claimLabel(claim), until: claimHoldUntil(deps, claim, 'statutory10Y'), entity: 'financeExpenseClaim', id: claim.id });
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
  // F8a: jede Position eines Antrags — auch im Entwurf —, einmal je Antrag.
  refs.push(...claimReferences(deps, eq(financeExpensePositions.projectId, projectId)));
  return refs;
}

/** Die Anträge, deren Positionen die Bedingung erfüllen — je Antrag ein Verweis. */
function claimReferences(deps: Deps, where: SQL, draftsOnly = false): RecordReference[] {
  const claimIds = [...new Set(deps.db.select({ claimId: financeExpensePositions.claimId }).from(financeExpensePositions).where(where).all().map((r) => r.claimId))];
  return claimIds.flatMap((claimId) => {
    const claim = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claimId)).get();
    if (!claim || (draftsOnly && claim.state !== 'draft')) return [];
    return [{ label: claimLabel(claim), entity: 'financeExpenseClaim', id: claim.id }];
  });
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
  // F8a: ein Beleg an einem Antragsentwurf — der Entwurf hält nicht, zeigt aber darauf.
  refs.push(...claimReferences(deps, eq(financeExpensePositions.documentId, documentId), true));
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
 * Woher eine Kontakt-IBAN stammt, steht nicht an der Zeile, sondern nur im
 * Protokoll ihres Anlegens (`finance.contactIban.link`) — von dort gelesen,
 * damit das Löschen dasselbe Feld nennt. `null`, wenn kein Eintrag zu finden ist.
 */
function learnedFromInternal(db: DbOrTx, bankAccountId: string): string | null {
  const row = db
    .select({ after: schema.auditLog.after })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, 'financeContactBankAccount'), eq(schema.auditLog.entityId, bankAccountId), eq(schema.auditLog.action, 'finance.contactIban.link')))
    .get();
  if (!row?.after) return null;
  const learnedFrom = (JSON.parse(row.after) as { learnedFrom?: unknown }).learnedFrom;
  return typeof learnedFrom === 'string' ? learnedFrom : null;
}

/**
 * Ein Dokument wurde gelöscht: Der Bezug bleibt als Grabstein (Nummer,
 * Prüfsumme), nur `documentId` wird geleert — sonst wäre ein einmal
 * verknüpfter Beleg nach seiner Frist nie aufräumbar. Ebenso an offenen
 * Posten und an Korrekturen. Ein Kontakt nimmt seine gelernten IBANs mit
 * (F5). Andere Entitätstypen: kein Vorgang von Finanzen, also nichts zu tun.
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
    // F8a: Die Position behält die Belegnummer als Grabstein; am Antrag verschwinden nur die IDs der Verzichtserklärung.
    tx.update(financeExpensePositions).set({ documentId: null }).where(eq(financeExpensePositions.documentId, id)).run();
    tx.update(financeExpenseClaims).set({ waiverDeclarationDocumentId: null }).where(eq(financeExpenseClaims.waiverDeclarationDocumentId, id)).run();
    tx.update(financeExpenseClaims).set({ waiverSignedDocumentId: null }).where(eq(financeExpenseClaims.waiverSignedDocumentId, id)).run();
    return;
  }
  if (entityType === 'contact') {
    // Die gelernten IBANs (F5) sind Arbeitsmaterial ohne eigenen Nachweis — sie gehen mit dem Kontakt.
    const rows = tx.select().from(financeContactBankAccounts).where(eq(financeContactBankAccounts.contactId, id)).all();
    for (const row of rows) {
      tx.delete(financeContactBankAccounts).where(eq(financeContactBankAccounts.id, row.id)).run();
      const learnedFrom = learnedFromInternal(tx, row.id);
      financeAudit(tx, deps, ctx, { action: 'finance.contactIban.delete', entity: 'financeContactBankAccount', id: row.id, before: learnedFrom ? { learnedFrom } : undefined, summary: `Kontakt-IBAN ${row.id} mit dem Kontakt gelöscht` });
    }
    // F8a: Entwürfe der Person sind Arbeitsmaterial ohne Nummer — sie gehen mit ihr. Eingereichte Anträge halten den
    // Kontakt fest (`contactHolds`), bis hierher kommt es mit ihnen nicht. Die Belege bleiben in der Akte, ihre Bezüge
    // auf den Entwurf nicht (wie `deleteExpenseDraft`).
    const drafts = tx.select().from(financeExpenseClaims).where(and(eq(financeExpenseClaims.contactId, id), eq(financeExpenseClaims.state, 'draft'))).all();
    for (const draft of drafts) {
      const positionCount = tx.delete(financeExpensePositions).where(eq(financeExpensePositions.claimId, draft.id)).run().changes;
      tx.delete(documentLinks).where(and(eq(documentLinks.entityType, 'financeExpenseClaim'), eq(documentLinks.entityId, draft.id))).run();
      tx.delete(financeExpenseClaims).where(eq(financeExpenseClaims.id, draft.id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.expenseClaim.draftDelete', entity: 'financeExpenseClaim', id: draft.id, before: { state: draft.state, positionCount }, summary: `Auslage (Entwurf) ${draft.id} mit dem Kontakt gelöscht` });
    }
    // Die Anspruchsgrundlage der Person — der Antrag trägt seine eigene Abschrift.
    const terms = tx.select().from(financeContactWaiverTerms).where(eq(financeContactWaiverTerms.contactId, id)).get();
    if (terms) {
      tx.delete(financeContactWaiverTerms).where(eq(financeContactWaiverTerms.id, terms.id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.contactWaiverTerms.delete', entity: 'financeContactWaiverTerms', id: terms.id, before: terms, summary: `Anspruchsgrundlage ${terms.id} mit dem Kontakt gelöscht` });
    }
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
 * Ob ein Geschäftsjahr importierte Kontoumsätze trägt (Umsatzdatum im
 * Zeitraum des Jahres) — reine Tabellenabfrage, kein Wissen über den
 * Laufdienst nötig (F4 Task 6, Spec 10.3: `financeImportPersonalData`).
 */
function hasImportedTransactionsInYear(db: DbOrTx, year: Pick<FinanceFiscalYearRow, 'startsOn' | 'endsOn'>): boolean {
  return !!db
    .select({ id: financeRawTransactions.id })
    .from(financeRawTransactions)
    .where(and(gte(financeRawTransactions.bookingDate, year.startsOn), lte(financeRawTransactions.bookingDate, year.endsOn)))
    .limit(1)
    .get();
}

/**
 * Je abgeschlossenem Geschäftsjahr, dessen Anker plus zehn Jahre abgelaufen
 * ist: ein Posten für den Fristenbildschirm (`financeYearPersonalData`) —
 * dazu, unabhängig vom Abschlussstand, je Geschäftsjahr mit importierten
 * Kontoumsätzen acht Jahre ab Jahresende (`financeImportPersonalData`, F4
 * Task 6, Spec 10.3). Ohne `href` — der Dienst, der anonymisiert, kommt erst
 * nach 0.2.0.
 */
export function financeRetentionDue(deps: Deps): DueItem[] {
  const today = isoNow(deps.clock).slice(0, 10);
  const due: DueItem[] = [];
  const years = deps.db.select().from(financeFiscalYears).all();

  const months10 = retentionMonths(deps, 'statutory10Y');
  if (months10 !== null) {
    for (const year of years) {
      if (fiscalYearStatusInternal(deps.db, year.id) !== 'closed') continue;
      const anchor = yearAnchorInternal(deps.db, year.id);
      if (anchor === null) continue;
      const dueSince = retentionEnd(anchor, months10);
      if (dueSince < today) due.push({ entity: 'financeYearPersonalData', id: year.id, label: `Finanzen ${year.designation}: personenbezogene Inhalte`, dueSince });
    }
  }

  const months8 = retentionMonths(deps, 'statutory8Y');
  if (months8 !== null) {
    for (const year of years) {
      if (!hasImportedTransactionsInYear(deps.db, year)) continue;
      const dueSince = retentionEnd(year.endsOn, months8);
      if (dueSince < today) due.push({ entity: 'financeImportPersonalData', id: year.id, label: `Finanzen ${year.designation}: importierte Kontoumsätze`, dueSince });
    }
  }

  return due;
}
