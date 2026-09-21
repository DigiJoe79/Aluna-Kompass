import { recordAudit, type CallContext, type DbOrTx, type Deps } from '@kompass/core';

export type FinanceEntity = 'financeAccount' | 'financeCategory' | 'financePurpose' | 'financeFiscalYear' | 'financePeriodEvent' | 'financeDatedValue' | 'financeEntry' | 'financeEntryDocument';

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
  financeAccount: ['kind', 'isMain', 'isActive', 'importFormat', 'openingBalanceCents', 'openingDate', 'bankDetailsChanged'],
  financeCategory: ['key', 'direction', 'sphere', 'incomeKind', 'costFunction', 'allowanceKind', 'statementSuffices', 'defaultTaxCode', 'inputTaxDeductible', 'countsTowardTurnover', 'isAssetSale', 'isActive'],
  financePurpose: ['projectId', 'targetCents', 'abroad', 'carryForwardCents', 'fulfilledAt', 'dissolvedAt', 'isActive'],
  financeFiscalYear: ['startsOn', 'endsOn', 'designation', 'taxReturnFiledOn'],
  financePeriodEvent: ['fiscalYearId', 'kind'],
  financeDatedValue: ['key', 'validFrom', 'value'],
  // Nie Text, nie Kontakt-ID (Spec 10.3): `channel`, `reviewed` und `cashWarning`
  // sind bewusst so benannt, dass der Verbotstest oben sie nicht trifft.
  financeEntry: ['status', 'number', 'entryDate', 'fiscalYearId', 'moneyLineCount', 'allocationLineCount', 'totalCents', 'reviewed', 'reversesEntryId', 'reversedByEntryId', 'correctionOfEntryId', 'channel', 'cashWarning'],
  // Nur IDs und Zählwerte (Spec 10.3): nie ein Dokumenttitel, nie eine Begründung.
  financeEntryDocument: ['entryId', 'documentId', 'viaUpload', 'withReplacement'],
};

const pick = (entity: FinanceEntity, data?: Record<string, unknown>) => (data ? Object.fromEntries(Object.entries(data).filter(([field]) => AUDIT_FIELDS[entity].includes(field))) : undefined);

export function financeAudit(tx: DbOrTx, deps: Deps, ctx: CallContext, entry: { action: `finance.${string}`; entity: FinanceEntity; id: string; before?: Record<string, unknown>; after?: Record<string, unknown>; summary: string }): void {
  recordAudit(tx, deps, ctx, { action: entry.action, entityType: entry.entity, entityId: entry.id, before: pick(entry.entity, entry.before), after: pick(entry.entity, entry.after), summary: entry.summary });
}
