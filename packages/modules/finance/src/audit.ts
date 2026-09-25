import { recordAudit, type CallContext, type DbOrTx, type Deps } from '@kompass/core';

export type FinanceEntity = 'financeAccount' | 'financeCategory' | 'financePurpose' | 'financeFiscalYear' | 'financePeriodEvent' | 'financeDatedValue' | 'financeEntry' | 'financeEntryDocument' | 'financeOpenItem' | 'financeAllocationCorrection' | 'financeEntryJustification' | 'financeProjectSettings' | 'financeCashCount' | 'financeSetup' | 'financeImportRun' | 'financeRawTransaction' | 'financeImportCandidate' | 'financeImportProfile' | 'financeImportRule' | 'financeContactBankAccount' | 'financeNotice' | 'financeConfirmation' | 'financeSigner' | 'financeInKindDetails' | 'financeConfirmationRun' | 'financeConfirmationRunItem' | 'financeExpenseClaim' | 'financeExpensePosition' | 'financeContactWaiverTerms';

/**
 * Was vom Finanzmodul ins Änderungsprotokoll darf — je Entität eine Liste, und
 * was nicht darin steht, wird verworfen. Das Protokoll ist unlöschbar und mit
 * `audit.view` frei durchsuchbar; Finanzdaten sind Namen, IBANs,
 * Verwendungszwecke. Deshalb nie Freitext, nie Namen, nie Bankdaten, **nie
 * Kontakt-IDs** (Spec 10.3): Das Vorher/Nachher steht im Fachdatensatz, das
 * Protokoll sagt nur, *dass* und *wer*. `summary` nennt Nummern und IDs.
 *
 * Jeder Plan ergänzt hier seine Entitäten; ein Test verbietet verdächtige
 * Feldnamen und `recordAudit` außerhalb dieser Datei.
 */
export const AUDIT_FIELDS: Record<FinanceEntity, readonly string[]> = {
  // `bankDetailsChanged` statt `ibanChanged`: Der Verbotstest dieser Datei
  // greift auf jede Zeichenfolge, die „iban“ enthält — auch als Teilstring
  // eines Flags, das selbst keine IBAN trägt.
  financeAccount: ['kind', 'isMain', 'isActive', 'importFormat', 'importProfileId', 'openingBalanceCents', 'openingDate', 'bankDetailsChanged'],
  financeCategory: ['key', 'direction', 'sphere', 'incomeKind', 'costFunction', 'allowanceKind', 'statementSuffices', 'defaultTaxCode', 'inputTaxDeductible', 'countsTowardTurnover', 'isAssetSale', 'isActive'],
  financePurpose: ['projectId', 'targetCents', 'abroad', 'carryForwardCents', 'fulfilledAt', 'dissolvedAt', 'isActive'],
  financeFiscalYear: ['startsOn', 'endsOn', 'designation', 'taxReturnFiledOn'],
  financePeriodEvent: ['fiscalYearId', 'kind', 'guardCount'],
  financeDatedValue: ['key', 'validFrom', 'value'],
  // Nie Text, nie Kontakt-ID (Spec 10.3): `channel`, `reviewed` und `cashWarning`
  // sind bewusst so benannt, dass der Verbotstest oben sie nicht trifft.
  financeEntry: ['status', 'number', 'entryDate', 'fiscalYearId', 'moneyLineCount', 'allocationLineCount', 'totalCents', 'reviewed', 'reversesEntryId', 'reversedByEntryId', 'correctionOfEntryId', 'channel', 'cashWarning', 'entryId', 'linkCount'],
  // Nur IDs und Zählwerte (Spec 10.3): nie ein Dokumenttitel, nie eine Begründung.
  financeEntryDocument: ['entryId', 'documentId', 'viaUpload', 'withReplacement'],
  // Nie die Zahlungsreferenz, nie die Notiz, nie der Kontakt (Spec 10.3).
  financeOpenItem: ['kind', 'itemDate', 'amountCents', 'dueOn', 'documentId', 'originType', 'originId', 'cancelled'],
  // Nie Kontakt-ID, nie Freitext (Spec 10.3, E18): nur, *dass* sich etwas ändert, nicht *worauf*.
  financeAllocationCorrection: ['entryId', 'lineId', 'state', 'partyChanged', 'projectChanged', 'purposeChanged', 'abroadChanged', 'withProof', 'section153'],
  // Nie die Begründung selbst (Spec 5.4): sie steht am Datensatz, nie im Protokoll.
  financeEntryJustification: ['entryId'],
  financeProjectSettings: ['projectId', 'targetCents', 'defaultPurposeId', 'abroad', 'publishDonationStatus'],
  // Nie die Zählenden, nie ihre Erklärung (Spec 10.3, Entschieden 1): nur, *dass* und *wie viel* abweicht.
  financeCashCount: ['accountId', 'countedOn', 'kind', 'differenceCents', 'documentNumber', 'entryId'],
  // Task 4/5 — nur, *dass* ein Einrichtungsschritt bestätigt oder ein Schalter gesetzt wurde, nie Namen.
  // `key`/`cents` (Nachtrag B): nur Schlüssel und Zahl der Grenze, nie ein Begründungstext.
  financeSetup: ['step', 'confirmedAt', 'applied', 'key', 'cents'],
  // F4 Task 2 — kein Dienst protokolliert hier schon (kommt mit Task 3/5); nur
  // IDs, Zähler und Daten, nie Gegenpartei, IBAN, Verwendungszweck oder Dateiname (Spec 10.3, E-Global-Constraint).
  financeImportRun: ['accountId', 'format', 'profileId', 'periodFrom', 'periodTo', 'openingCents', 'closingCents', 'countNew', 'countKnown', 'countHeld', 'countPendingSkipped', 'gapFrom', 'gapTo', 'failureCode', 'failureLine', 'discarded', 'fileKeyCleared'],
  financeRawTransaction: ['runId', 'accountId', 'bookingDate', 'valueDate', 'amountCents', 'lineIndex'],
  financeImportCandidate: ['runId', 'accountId', 'decision', 'matchesRawTransactionId', 'rawTransactionId'],
  // F4b — nie Spaltennamen (Kopfzeilen können Namen tragen), nie der frei getippte Formatname; die Kopfzeile nur als Prüfsumme.
  financeImportProfile: ['accountId', 'encoding', 'delimiter', 'headerChecksum', 'switched', 'builtinKey'],
  // F5 — nie der Regelname, nie die Textbedingung, nie die IBAN, nie die Kontakt-ID (Spec 10.3).
  // Die Flags heißen `hasBankDetailsCondition`/`hasWordCondition`/`partySet` statt
  // `hasIbanCondition`/`hasTextCondition`/`contactSet`: Der Verbotstest greift auf „iban“, „text“ und „contact“ als Teilstring.
  financeImportRule: ['accountId', 'direction', 'categoryId', 'projectId', 'purposeId', 'taxCode', 'isActive', 'sortOrder', 'hasBankDetailsCondition', 'hasWordCondition', 'hasAmountCondition', 'partySet'],
  // Nur woher die Zuordnung stammt: 'booking' | 'contactCreate' | 'manual'.
  financeContactBankAccount: ['learnedFrom'],
  // F6a — nie Finanzamt, Steuernummer, Zwecke im Wortlaut, Begründung (Spec 10.3): nur Art, Daten und Dokument-IDs.
  financeNotice: ['kind', 'noticeDate', 'exemptFrom', 'assessmentPeriod', 'documentId', 'supersededOn', 'supersededDocumentId', 'voided'],
  // Nie Kontakt-ID, nie Name oder Anschrift, nie Begründung: Nummer, Daten, Beträge, Flags.
  financeConfirmation: ['kind', 'noticeId', 'documentId', 'documentNumber', 'issuedOn', 'machine', 'signerId', 'expenseWaiver', 'totalCents', 'lineCount', 'channel', 'voided', 'sentBeforeVoid', 'sentVia', 'signedDocumentId', 'originalReturned', 'taxOfficeInformed'],
  // Nie der Name, nie die Bytes der Unterschrift — nur, *dass* es ein Faksimile gibt.
  financeSigner: ['validFrom', 'validTo', 'hasFacsimile', 'notifiedOn'],
  // Nie Gegenstand, Zustand, Wertermittlung (Freitext).
  financeInKindDetails: ['lineId', 'origin', 'withdrawalValueCents', 'vatCents', 'proofDocumentId'],
  // F6b — der Lauf nur mit Parametern und Zählern (die Ausschlüsse als Zahl), der Posten nur mit IDs und Ausgang: nie Kontakt-ID, nie Sortierschlüssel.
  financeConfirmationRun: ['year', 'minCents', 'excludedCount', 'followUpOfRunId', 'startedOn', 'itemCount', 'issuedCount', 'failedCount', 'finished', 'dispatchedVia', 'channel'],
  financeConfirmationRunItem: ['runId', 'kind', 'state', 'confirmationId', 'errorCode', 'totalCents', 'lineCount'],
  // F8a — der Antrag nur mit Zustand, Nummer, Zählern, Beträgen und IDs: nie Kontakt-ID, IBAN, Anspruchsgrundlage,
  // Begründung oder Ablehnungsgrund (Spec 10.3). `rejected` statt des Grundes.
  financeExpenseClaim: ['state', 'number', 'positionCount', 'totalCents', 'waiver', 'recurring', 'submittedAt', 'approvedAt', 'rejected', 'openItemId', 'entryId', 'copiedFromClaimId', 'channel', 'waiverFreeFundsCents'],
  // Nie „Wofür“, Strecke oder Anlass — Freitext.
  financeExpensePosition: ['claimId', 'kind', 'positionDate', 'amountCents', 'tripKm', 'documentId', 'categoryId', 'projectId', 'purposeId'],
  // Nur das Datum der Vereinbarung, nie ihr Wortlaut.
  financeContactWaiverTerms: ['agreedOn'],
};

const pick = (entity: FinanceEntity, data?: Record<string, unknown>) => (data ? Object.fromEntries(Object.entries(data).filter(([field]) => AUDIT_FIELDS[entity].includes(field))) : undefined);

export function financeAudit(tx: DbOrTx, deps: Deps, ctx: CallContext, entry: { action: `finance.${string}`; entity: FinanceEntity; id: string; before?: Record<string, unknown>; after?: Record<string, unknown>; summary: string }): void {
  recordAudit(tx, deps, ctx, { action: entry.action, entityType: entry.entity, entityId: entry.id, before: pick(entry.entity, entry.before), after: pick(entry.entity, entry.after), summary: entry.summary });
}
