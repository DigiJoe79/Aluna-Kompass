import { expectedVersionField, invalid, isoNow, newId, notFound, ok, requirePermission, schema, staleVersion, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { unlinkDocumentInternal } from '@kompass/module-dms';
import { projects } from '@kompass/module-projects';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { financeAccounts, financeAllocationCorrections, financeAllocationLines, financeCategories, financeContactTaxDetails, financeDirectDebitItems, financeEntries, financeEntryDocuments, financeEntryJustifications, financeImportRuns, financeInKindDetails, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, financePartnerPaidLines, financePartnerPayments, financePurposes, financeRawTransactions, type FinanceAllocationLineRow, type FinanceEntryRow, type FinanceMoneyLineRow } from '../schema';
import { boardAllowanceProblemInternal } from './board';
import { purposeGoingNegative } from './purpose-negative';
import { mayBeDonationReturnInternal, notReturnMarkInternal, type NotReturnMarkView } from './not-return';
import { requireFinanceRead } from './access';
import { ADDS_TO_ASSETS_OPT_OUTS, PARTNER_GRANT_CATEGORY_KEYS, REVERSE_CHARGE_CODES, TAX_CODES, type AddsToAssetsOptOut } from './codes';
import { ensureFiscalYearFor } from './fiscal-years';
import { projectFinanceInternal } from './project-settings';
import { accountLedgerInternal } from './queries';
import { taxContextAt, taxOf, type TaxCode, type TaxResult } from './tax';
import { settlementWarningsInternal, type SettlementWarning, type SettlementWarningParams } from './settlement-warnings';
import { taxCodeOptionsInternal } from './vat-settings';

/** Eine Geldzeile erledigt einen offenen Posten ganz oder teilweise (Spec 5.3). */
export interface MoneyLineSettlementView {
  id: string;
  openItemId: string;
  amountCents: number;
  /** Rück-Ausgleich (Spec Mitglieder und Lastschrift § 6.2): der Ausgleich, den diese Zeile zurücknimmt. */
  reversesSettlementId: string | null;
}
export type MoneyLineView = FinanceMoneyLineRow & { settlements: MoneyLineSettlementView[] };
export type AllocationLineView = FinanceAllocationLineRow & {
  /** Nach den Werten des Buchungstags berechnet — nie gespeichert. `null`, wenn dafür kein Satz hinterlegt ist. */
  tax: TaxResult | null;
  /** Es gibt eine angewandte Zuordnungskorrektur (E18). */
  corrected: boolean;
  /** Wartet eine Korrektur auf Freigabe im abgeschlossenen Jahr? */
  pendingCorrectionId: string | null;
};

/** Ein Beleg in der Sicht der Buchung — Nummer und Prüfsumme bleiben auch nach Widerruf oder Grabstein (F2c) stehen. */
export interface VoucherListEntry {
  linkId: string;
  documentId: string | null;
  documentNumber: string;
  documentDeletedAt: string | null;
  addedAt: string;
  revokedAt: string | null;
  replacedByLinkId: string | null;
}

export interface EntryDocumentationState {
  /**
   * `notApplicable`: ein Storno oder eine stornierte Buchung — eine
   * Gegenbuchung braucht nie einen eigenen Beleg (Prozesstest-Befund 2).
   * `onOrigin` (F7 Task 4, Annahme 12): die Buchung begleicht einen Posten mit
   * Herkunft `financePartnerPayment` oder `financeExpenseClaim` — die Belege
   * liegen am Vorgang, nicht an dieser Buchung.
   */
  state: 'voucher' | 'statementSuffices' | 'notApplicable' | 'missing' | 'onOrigin';
  warnExpenseAboveLimit: boolean;
  /** Nur bei `onOrigin`: wohin der Link im Journal zeigt. */
  origin?: { entity: 'financeExpenseClaim' | 'financePartnerPayment'; id: string };
}

export interface EntryView extends FinanceEntryRow {
  moneyLines: MoneyLineView[];
  allocationLines: AllocationLineView[];
  /** Σ Geldzeilen − Σ Zuordnungszeilen; 0 = ausgeglichen. „Noch 37,20 € zu verteilen.“ */
  remainderCents: number;
  taxTotals: { outputTaxCents: number; reverseChargeTaxCents: number; inputTaxCents: number; inputTaxMemoCents: number };
  vouchers: VoucherListEntry[];
  documentation: EntryDocumentationState;
  /** Eine unbelegte, festgeschriebene Buchung trägt eine Begründung zum Periodenabschluss (F2c). */
  justified: boolean;
  /** AC: eine Auszahlung, die ausdrücklich keine Rückgabe ist — sperrt die Bestätigungen des Kontakts nicht als möglicher Rückläufer. */
  notReturn: NotReturnMarkView | null;
  /**
   * Plan E9 Task 2 (Befund 30 b): Die Auszahlung könnte eine Rückgabe einer bescheinigbaren Zuwendung sein und sperrt
   * deren Bestätigung, bis sie verknüpft oder als „keine Rückgabe“ gekennzeichnet ist (`mayBeDonationReturnInternal`).
   * Nur `getEntry` setzt das Feld — es braucht die Einstellung zu Mitgliedsbeiträgen.
   */
  mayBeReturn?: boolean;
  /**
   * Befund 20: ein Entwurf mit Datum in der Zukunft warnt, sperrt aber
   * nicht — Festschreiben lehnt das ab (`entryDateInFuture`). Berechnet, nie
   * gespeichert; nur berechnet, wo der Aufrufer ein „heute“ mitgibt
   * (`entryViewInternal`s dritter Parameter) — sonst immer leer.
   */
  warnings: readonly EntryWarning[];
  /** Plan N2 Task 2: zu `inSubmittedRun` der Einzugstag, zu `overpaid` der Betrag über dem offenen. */
  warningParams: SettlementWarningParams;
  /**
   * Befund 25: ein Hinweis ohne Sperre — anders als `warnings` kein Zeichen
   * für einen möglichen Fehler, nur etwas, das die Kassenprüfung sehen soll.
   * Nur `finalizeInternal` setzt ihn (Barspende ab Schwelle); sonst immer leer.
   */
  notices: readonly EntryNotice[];
  /** Befund AI: zu `allowanceExceeded` — wer, welche Pauschale, welches Jahr, wie viel darüber. Nur `finalizeInternal` setzt es. */
  allowanceExceeded?: AllowanceExceededNotice[];
  /** N11 a: zu `taxCodeNotOffered` — Zeile und Kennzeichen, das der Buchungstag nicht mehr anbietet. Nur `finalizeInternal` setzt es. */
  taxCodeNotOffered?: TaxCodeNotOfferedNotice[];
}

/**
 * `futureDate` sperrt nicht. `inSubmittedRun` und `overpaid` (Plan N2 Task 2) verlangen beim Festschreiben eine
 * Bestätigung (`acknowledgedWarnings`) — berechnet an jedem Entwurf, nie gespeichert.
 */
export type EntryWarning = 'futureDate' | SettlementWarning;
/** `vatAmendment` (N8): die Buchung ändert einen abgegebenen Umsatzsteuer-Zeitraum — eine Berichtigung ist fällig. */
export type EntryNotice = 'cashDonationAboveAlert' | 'allowanceExceeded' | 'returnWithoutOrigin' | 'vatAmendment' | 'taxCodeNotOffered' | 'partnerPaymentMissing';

/** Befund AI: eine Person liegt nach dieser Buchung über der Jahresgrenze einer Pauschale — eine Warnung, keine Sperre. */
export interface AllowanceExceededNotice {
  contactId: string;
  contactName: string;
  kind: 'volunteer' | 'trainer';
  year: number;
  overCents: number;
}

/** Zeilen, wie `saveDraft`, `finalize.ts` und `reverse.ts` sie an die Datenbank geben — Vorbelegung ist schon aufgelöst. */
export interface MoneyLineWrite {
  accountId: string;
  amountCents: number;
  rawTransactionId?: string | null;
  /** Fehlt beim Storno (F2a) bewusst: Ein Storno kopiert keine Settlements. */
  settlements?: readonly MoneyLineSettlementInput[];
}
export interface AllocationLineWrite {
  categoryId: string;
  amountCents: number;
  taxCode: TaxCode;
  rateKind: 'standard' | 'reduced';
  projectId: string | null;
  purposeId: string | null;
  contactId: string | null;
  abroad: boolean;
  originLineId: string | null;
  addsToAssets: boolean;
  /** Rechenschaft D2: Grund gegen die Zuführung zum Vermögen und erhaltene Vermögensausstattung — fehlen sie, gilt `null`/`false`. */
  addsToAssetsOptOut?: AddsToAssetsOptOut | null;
  assetEndowment?: boolean;
  /** Plan L3: der Posten eines Einzugs, den die Zeile bucht. Fehlt beim Storno. */
  directDebitItemId?: string | null;
  /** E6a: Leistungsdatum an § 13b-/Erwerbszeilen (`REVERSE_CHARGE_CODES`); fehlt es, gilt `null`. */
  serviceDate?: string | null;
}

const settlementInputSchema = z.object({
  openItemId: z.string().min(1),
  amountCents: z.number().int().positive(),
  /** Rück-Ausgleich: nimmt diesen festgeschriebenen Ausgleich des Postens ganz oder teilweise zurück (Rückgabe einer Zahlung). */
  reversesSettlementId: z.string().min(1).nullable().optional(),
});
/** Ein Ausgleich an einer Geldzeile; mit `reversesSettlementId` ein Rück-Ausgleich (Spec Mitglieder und Lastschrift § 6.2). */
export type MoneyLineSettlementInput = z.infer<typeof settlementInputSchema>;

const moneyLineSchema = z.object({
  accountId: z.string().min(1),
  amountCents: z.number().int().refine((v) => v !== 0, 'amountCentsRequired'),
  settlements: z.array(settlementInputSchema).optional(),
  /** F4 Task 4: der Kontoumsatz, den diese Zeile bucht — geprüft in `checkRawTransaction`. */
  rawTransactionId: z.string().min(1).nullable().optional(),
});

const allocationLineSchema = z.object({
  categoryId: z.string().min(1),
  amountCents: z.number().int().refine((v) => v !== 0, 'amountCentsRequired'),
  taxCode: z.enum(TAX_CODES).optional(),
  rateKind: z.enum(['standard', 'reduced']).optional(),
  projectId: z.string().min(1).nullable().optional(),
  purposeId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  abroad: z.boolean().optional(),
  originLineId: z.string().min(1).nullable().optional(),
  addsToAssets: z.boolean().optional(),
  /** Rechenschaft D2: Pflicht, wenn eine Erbschaft oder erhaltene Vermögensausstattung nicht dem Vermögen zugeführt wird. */
  addsToAssetsOptOut: z.enum(ADDS_TO_ASSETS_OPT_OUTS).nullable().optional(),
  /** Rechenschaft D2: erhaltene Vermögensausstattung (§ 58 Nr. 3 AO) — nur bei Zuwendungen anderer Organisationen mit Kontakt. */
  assetEndowment: z.boolean().optional(),
  /** Plan L3: der Posten eines Einzugs, den diese Zeile bucht (aus dem Vorschlag „Einzug“). */
  directDebitItemId: z.string().min(1).nullable().optional(),
  /** E6a: Leistungsdatum, beim Drittland das Rechnungsdatum — nur an § 13b-/Erwerbszeilen. */
  serviceDate: z.iso.date().nullable().optional(),
});

/** Auch von `bookEntry` (finalize.ts) benutzt — dort ohne `id`/`expectedVersion`. */
export const entryLinesSchema = z.object({
  id: z.string().min(1).optional(),
  expectedVersion: expectedVersionField,
  entryDate: z.string().date(),
  text: z.string().trim().min(1).max(300),
  moneyLines: z.array(moneyLineSchema),
  allocationLines: z.array(allocationLineSchema),
  /** Befund AH und Q: Begründung für eine Pauschale an ein Vorstandsmitglied ohne gültige Grundlage oder für einen Zweck, der ins Minus ginge — Pflicht nur dann, gespeichert an der Buchung. */
  reason: z.string().trim().max(500).optional(),
});
export type EntryLinesInput = z.infer<typeof entryLinesSchema>;

const idSchema = z.object({ id: z.string().min(1) });

const reviewSchema = z.object({ id: z.string().min(1), reviewed: z.boolean(), expectedVersion: expectedVersionField });

const listSchema = z.object({
  /** draft = ungeprüfter Entwurf; reviewed = Entwurf mit reviewedAt; final = festgeschrieben und nicht zurückgenommen; reversed = festgeschrieben mit reversedByEntryId. */
  state: z.enum(['draft', 'reviewed', 'final', 'reversed']).optional(),
  categoryId: z.string().min(1).optional(),
  /** Teil des Buchungstexts oder der Nummer, oder ein Betrag ("12,50"/"1250" → Cent), trifft eine Geld- oder Zuordnungszeile. */
  text: z.string().trim().min(1).optional(),
  /** documentation.state === 'missing'. */
  withoutVoucher: z.boolean().optional(),
  /** createdChannel === 'mcp'. */
  agentPrepared: z.boolean().optional(),
  orderBy: z.object({ field: z.enum(['entryDate', 'number', 'text', 'amount']), direction: z.enum(['asc', 'desc']) }).optional(),
  status: z.enum(['draft', 'final']).optional(),
  fiscalYearId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  /** Genau diese Buchungen — der Link aus der Vorschau einer Regel auf die „anders gebuchten“ (F5). */
  ids: z.array(z.string().min(1)).min(1).max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** '12,50' oder '1250' → 1250 Cent; sonst `null`. Eigener, kleiner Parser fürs Modul — die reiche Fassung fürs Formular steht in der App (Task 5). */
function parseSearchAmountCents(raw: string): number | null {
  const trimmed = raw.trim();
  const comma = /^-?\d+,\d{1,2}$/.exec(trimmed);
  if (comma) {
    const negative = trimmed.startsWith('-');
    const [intPart, fracPartRaw] = trimmed.replace('-', '').split(',') as [string, string];
    const fracPart = fracPartRaw.length === 1 ? `${fracPartRaw}0` : fracPartRaw;
    const cents = Number(intPart) * 100 + Number(fracPart);
    return negative ? -cents : cents;
  }
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return null;
}

/** Σ Geldzeilen; ohne Geldzeile Σ der positiven Zuordnungszeilen — für die Sortierung nach Betrag. */
function amountSortKey(view: EntryView): number {
  if (view.moneyLines.length > 0) return view.moneyLines.reduce((s, l) => s + l.amountCents, 0);
  return view.allocationLines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
}

/** Summen über die gefilterte Menge (nicht nur die Seite): Zuordnungszeilen nach Richtung ihrer Kategorie; Umbuchungen (`transit`) tragen nichts bei. */
function totalsOf(db: DbOrTx, entries: readonly EntryView[]): { incomeCents: number; expenseCents: number; resultCents: number } {
  const categoryIds = [...new Set(entries.flatMap((e) => e.allocationLines.map((l) => l.categoryId)))];
  const categories = categoriesById(db, categoryIds);
  let incomeCents = 0;
  let expenseCents = 0;
  for (const entry of entries) {
    for (const line of entry.allocationLines) {
      const direction = categories.get(line.categoryId)?.direction;
      if (direction === 'income') incomeCents += line.amountCents;
      else if (direction === 'expense') expenseCents += -line.amountCents;
    }
  }
  return { incomeCents, expenseCents, resultCents: incomeCents - expenseCents };
}

/** Für `finalize.ts` und `reverse.ts`: Zeilen einer Buchung als Ganzes ersetzen, solange ihr Kopf `draft` ist. */
export function writeLinesInternal(tx: DbOrTx, entryId: string, lines: { moneyLines: readonly MoneyLineWrite[]; allocationLines: readonly AllocationLineWrite[] }): void {
  // Alte Settlements zuerst: Der Fremdschlüssel auf die Geldzeile verbietet sonst deren Löschen.
  const oldMoneyLineIds = tx.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).all().map((r) => r.id);
  if (oldMoneyLineIds.length > 0) tx.delete(financeOpenItemSettlements).where(inArray(financeOpenItemSettlements.moneyLineId, oldMoneyLineIds)).run();
  // Was an einer Zuordnungszeile des Entwurfs hängt, wandert mit ihr (Stelle für Stelle); fällt die Stelle weg, fällt es mit.
  const attached = detachLineReferencesInternal(tx, entryId);
  tx.delete(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).run();
  tx.delete(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).run();
  lines.moneyLines.forEach((line, position) => {
    const id = newId();
    tx.insert(financeMoneyLines).values({ id, entryId, position, accountId: line.accountId, amountCents: line.amountCents, rawTransactionId: line.rawTransactionId ?? null, rawReleasedAt: null }).run();
    for (const settlement of line.settlements ?? []) {
      tx.insert(financeOpenItemSettlements).values({ id: newId(), moneyLineId: id, openItemId: settlement.openItemId, amountCents: settlement.amountCents, reversesSettlementId: settlement.reversesSettlementId ?? null }).run();
    }
  });
  lines.allocationLines.forEach((line, position) => {
    tx.insert(financeAllocationLines)
      .values({
        id: newId(),
        entryId,
        position,
        categoryId: line.categoryId,
        amountCents: line.amountCents,
        taxCode: line.taxCode,
        rateKind: line.rateKind,
        projectId: line.projectId,
        purposeId: line.purposeId,
        contactId: line.contactId,
        abroad: line.abroad,
        originLineId: line.originLineId,
        addsToAssets: line.addsToAssets,
        addsToAssetsOptOut: line.addsToAssetsOptOut ?? null,
        assetEndowment: line.assetEndowment ?? false,
        directDebitItemId: line.directDebitItemId ?? null,
        serviceDate: line.serviceDate ?? null,
      })
      .run();
  });
  reattachLineReferencesInternal(tx, entryId, attached);
}

/**
 * Anhängsel an Zuordnungszeilen eines Entwurfs: die bezahlte Zeile einer
 * Zahlung an Partner (Task 5, Arbeitsliste) und die Angaben zur Sachspende
 * (Task 6b — ohne sie scheiterte das erneute Sichern am Fremdschlüssel). Vor dem Neuschreiben der Zeilen
 * gelöst — der Fremdschlüssel verböte sonst das Löschen —, danach an die neue
 * Zeile derselben Stelle gehängt.
 */
interface AttachedReferences {
  paidLines: { row: typeof financePartnerPaidLines.$inferSelect; position: number }[];
  inKind: { row: typeof financeInKindDetails.$inferSelect; position: number }[];
}

function detachLineReferencesInternal(tx: DbOrTx, entryId: string): AttachedReferences {
  const oldLines = tx.select({ id: financeAllocationLines.id, position: financeAllocationLines.position }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).all();
  if (oldLines.length === 0) return { paidLines: [], inKind: [] };
  const positionOf = new Map(oldLines.map((l) => [l.id, l.position] as const));
  const paidLines = tx.select().from(financePartnerPaidLines).where(inArray(financePartnerPaidLines.paidLineId, [...positionOf.keys()])).all().map((row) => ({ row, position: positionOf.get(row.paidLineId)! }));
  if (paidLines.length > 0) tx.delete(financePartnerPaidLines).where(inArray(financePartnerPaidLines.id, paidLines.map((p) => p.row.id))).run();
  const inKind = tx.select().from(financeInKindDetails).where(inArray(financeInKindDetails.lineId, [...positionOf.keys()])).all().map((row) => ({ row, position: positionOf.get(row.lineId)! }));
  if (inKind.length > 0) tx.delete(financeInKindDetails).where(inArray(financeInKindDetails.lineId, inKind.map((d) => d.row.lineId))).run();
  return { paidLines, inKind };
}

function reattachLineReferencesInternal(tx: DbOrTx, entryId: string, attached: AttachedReferences): void {
  if (attached.paidLines.length === 0 && attached.inKind.length === 0) return;
  const byPosition = new Map(tx.select({ id: financeAllocationLines.id, position: financeAllocationLines.position }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).all().map((l) => [l.position, l.id] as const));
  for (const { row, position } of attached.paidLines) {
    const lineId = byPosition.get(position);
    if (lineId) tx.insert(financePartnerPaidLines).values({ ...row, paidLineId: lineId }).run();
  }
  for (const { row, position } of attached.inKind) {
    const lineId = byPosition.get(position);
    if (lineId) tx.insert(financeInKindDetails).values({ ...row, lineId }).run();
  }
}

const EMPTY_TAX_TOTALS = { outputTaxCents: 0, reverseChargeTaxCents: 0, inputTaxCents: 0, inputTaxMemoCents: 0 };

/**
 * Direkt gelesen, ohne `deps`: `entryViewInternal` kennt nur `db`, nicht die
 * volle `Deps` (es wird auch mit einer offenen Transaktion aufgerufen). Der
 * Vorgabewert 0 stimmt mit dem Vorgabewert der Einstellung überein.
 */
function statementSufficesBelowCentsInternal(db: DbOrTx): number {
  const row = db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, 'finance.statementSufficesBelowCents')).get();
  return row ? (JSON.parse(row.value) as number) : 0;
}

/**
 * Belegt (Spec 5.2): ein nicht widerrufener Beleg — oder, wenn keine Geldzeile
 * auf einem Barkonto liegt, alle betroffenen Kategorien tragen „Auszug genügt“
 * **und** eine Geldzeile hat einen Rohumsatz. Eine Umbuchung ohne
 * Zuordnungszeilen erfüllt „alle Kategorien“ leer und damit trivial.
 */
export function documentationOf(db: DbOrTx, entryId: string, settings: { statementSufficesBelowCents: number }): EntryDocumentationState {
  const voucherRows = db.select({ documentId: financeEntryDocuments.documentId, revokedAt: financeEntryDocuments.revokedAt }).from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, entryId)).all();
  if (voucherRows.some((v) => v.revokedAt === null)) return { state: 'voucher', warnExpenseAboveLimit: false };

  const head = db.select({ reversesEntryId: financeEntries.reversesEntryId, reversedByEntryId: financeEntries.reversedByEntryId }).from(financeEntries).where(eq(financeEntries.id, entryId)).get();
  if (head?.reversesEntryId || head?.reversedByEntryId) return { state: 'notApplicable', warnExpenseAboveLimit: false };

  const moneyLines = db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).all();
  // F7 Task 4 (Annahme 12): eine Zahlung aus einem Posten mit Herkunft Zahlung an Partner oder Antrag —
  // die Belege liegen am Vorgang.
  if (moneyLines.length > 0) {
    const settlementRows = db.select({ openItemId: financeOpenItemSettlements.openItemId }).from(financeOpenItemSettlements).where(inArray(financeOpenItemSettlements.moneyLineId, moneyLines.map((l) => l.id))).all();
    if (settlementRows.length > 0) {
      const items = db.select({ id: financeOpenItems.id, originType: financeOpenItems.originType, originId: financeOpenItems.originId }).from(financeOpenItems).where(inArray(financeOpenItems.id, settlementRows.map((s) => s.openItemId))).all();
      const origin = items.find((i) => (i.originType === 'financePartnerPayment' || i.originType === 'financeExpenseClaim') && i.originId);
      if (origin) return { state: 'onOrigin', warnExpenseAboveLimit: false, origin: { entity: origin.originType as 'financeExpenseClaim' | 'financePartnerPayment', id: origin.originId! } };
    }
  }
  // Befund X: eine nachträgliche Zahlung an Partner hängt über eine bezahlte Zeile an der Buchung, ohne offenen
  // Posten. Belegt ab der Freigabe wie der Weg über den Posten — die Verwendungsnachweise sind eine eigene Pflicht.
  const paidOrigin = db
    .select({ paymentId: financePartnerPaidLines.paymentId })
    .from(financePartnerPaidLines)
    .innerJoin(financeAllocationLines, eq(financeAllocationLines.id, financePartnerPaidLines.paidLineId))
    .innerJoin(financePartnerPayments, eq(financePartnerPayments.id, financePartnerPaidLines.paymentId))
    .where(and(eq(financeAllocationLines.entryId, entryId), eq(financePartnerPayments.state, 'approved')))
    .get();
  if (paidOrigin) return { state: 'onOrigin', warnExpenseAboveLimit: false, origin: { entity: 'financePartnerPayment', id: paidOrigin.paymentId } };
  const accounts = accountsById(db, moneyLines.map((l) => l.accountId));
  const hasCash = [...accounts.values()].some((a) => a.kind === 'cash');
  const allocationLines = db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).all();
  if (hasCash) {
    // Befund 22/26: eine reine Bewegung zwischen eigenen Konten (keine Zuordnungszeilen) gilt als belegt,
    // sobald die Nicht-Kassen-Seite einen Kontoumsatz trägt — auch mit einer Kassenseite (wie PayPal↔Bank).
    // Bareinnahmen/-ausgaben mit Zuordnungszeilen brauchen weiterhin einen eigenen Beleg.
    const nonCashDocumented = allocationLines.length === 0 && moneyLines.some((l) => accounts.get(l.accountId)?.kind !== 'cash' && l.rawTransactionId !== null);
    if (!nonCashDocumented) return { state: 'missing', warnExpenseAboveLimit: false };
  }

  const categories = categoriesById(db, allocationLines.map((l) => l.categoryId));
  const allSuffice = allocationLines.every((l) => categories.get(l.categoryId)?.statementSuffices === true);
  const hasRaw = moneyLines.some((l) => l.rawTransactionId !== null);
  if (!allSuffice || !hasRaw) return { state: 'missing', warnExpenseAboveLimit: false };

  const limit = settings.statementSufficesBelowCents;
  const warn = limit > 0 && allocationLines.some((l) => l.amountCents < 0 && Math.abs(l.amountCents) > limit);
  return { state: 'statementSuffices', warnExpenseAboveLimit: warn };
}

export function entryViewInternal(db: DbOrTx, id: string, today?: string): EntryView | null {
  const row = db.select().from(financeEntries).where(eq(financeEntries.id, id)).get();
  if (!row) return null;
  const moneyLineRows = db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, id)).orderBy(asc(financeMoneyLines.position)).all();
  const settlementRows = moneyLineRows.length > 0 ? db.select().from(financeOpenItemSettlements).where(inArray(financeOpenItemSettlements.moneyLineId, moneyLineRows.map((l) => l.id))).all() : [];
  const moneyLines: MoneyLineView[] = moneyLineRows.map((l) => ({ ...l, settlements: settlementRows.filter((s) => s.moneyLineId === l.id).map((s) => ({ id: s.id, openItemId: s.openItemId, amountCents: s.amountCents, reversesSettlementId: s.reversesSettlementId })) }));
  const allocationLineRows = db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, id)).orderBy(asc(financeAllocationLines.position)).all();
  const moneySum = moneyLines.reduce((s, l) => s + l.amountCents, 0);
  const allocationSum = allocationLineRows.reduce((s, l) => s + l.amountCents, 0);

  // Immer berechnet, nie gespeichert (Spec 5.2): eine nachträglich richtig datierte Besteuerungsform macht alte Buchungen richtig.
  const context = taxContextAt(db, row.entryDate);
  const categories = categoriesById(db, allocationLineRows.map((l) => l.categoryId));
  const correctionRows =
    allocationLineRows.length > 0
      ? db.select({ lineId: financeAllocationCorrections.lineId, state: financeAllocationCorrections.state, id: financeAllocationCorrections.id }).from(financeAllocationCorrections).where(inArray(financeAllocationCorrections.lineId, allocationLineRows.map((l) => l.id))).all()
      : [];
  const allocationLines: AllocationLineView[] = allocationLineRows.map((l) => {
    const own = correctionRows.filter((c) => c.lineId === l.id);
    return {
      ...l,
      tax: context ? taxOf({ amountCents: l.amountCents, taxCode: l.taxCode as TaxCode, rateKind: l.rateKind as 'standard' | 'reduced', taxation: context.taxation, inputTaxDeductible: categories.get(l.categoryId)?.inputTaxDeductible ?? 'no', rates: context.rates }) : null,
      corrected: own.some((c) => c.state === 'applied'),
      pendingCorrectionId: own.find((c) => c.state === 'pending')?.id ?? null,
    };
  });
  const taxTotals = allocationLines.reduce((acc, l) => {
    if (!l.tax) return acc;
    return { outputTaxCents: acc.outputTaxCents + l.tax.outputTaxCents, reverseChargeTaxCents: acc.reverseChargeTaxCents + l.tax.reverseChargeTaxCents, inputTaxCents: acc.inputTaxCents + l.tax.inputTaxCents, inputTaxMemoCents: acc.inputTaxMemoCents + l.tax.inputTaxMemoCents };
  }, EMPTY_TAX_TOTALS);

  const voucherRows = db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, id)).all();
  const vouchers: VoucherListEntry[] = voucherRows.map((v) => ({ linkId: v.id, documentId: v.documentId, documentNumber: v.documentNumber, documentDeletedAt: v.documentDeletedAt, addedAt: v.addedAt, revokedAt: v.revokedAt, replacedByLinkId: v.replacedByLinkId }));
  const documentation = documentationOf(db, id, { statementSufficesBelowCents: statementSufficesBelowCentsInternal(db) });
  const justified = !!db.select({ entryId: financeEntryJustifications.entryId }).from(financeEntryJustifications).where(eq(financeEntryJustifications.entryId, id)).get();

  const warnings: EntryWarning[] = today !== undefined && row.status === 'draft' && row.entryDate > today ? ['futureDate'] : [];
  let warningParams: SettlementWarningParams = {};
  if (row.status === 'draft' && !row.reversesEntryId) {
    const settlement = settlementWarningsInternal(db, { moneyLines, allocationLines });
    warnings.push(...settlement.warnings);
    warningParams = settlement.params;
  }
  const notReturn = notReturnMarkInternal(db, id);
  return { ...row, moneyLines, allocationLines, remainderCents: moneySum - allocationSum, taxTotals, vouchers, documentation, justified, notReturn, warnings, warningParams, notices: [] };
}

/** Nur Nummern und Zähler — nie Text, nie Kontakt (Spec 10.3). */
function auditSnapshot(view: EntryView, ctx: CallContext): Record<string, unknown> {
  const totalCents =
    view.moneyLines.length > 0
      ? view.moneyLines.reduce((s, l) => s + Math.abs(l.amountCents), 0)
      : view.allocationLines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
  return {
    status: view.status,
    number: view.number,
    entryDate: view.entryDate,
    fiscalYearId: view.fiscalYearId,
    moneyLineCount: view.moneyLines.length,
    allocationLineCount: view.allocationLines.length,
    totalCents,
    reviewed: view.reviewedAt !== null,
    reversesEntryId: view.reversesEntryId,
    reversedByEntryId: view.reversedByEntryId,
    correctionOfEntryId: view.correctionOfEntryId,
    channel: ctx.channel,
    cashWarning: view.cashWarningReason !== null,
  };
}

function accountsById(db: DbOrTx, ids: readonly string[]) {
  const rows = ids.length > 0 ? db.select().from(financeAccounts).where(inArray(financeAccounts.id, [...new Set(ids)])).all() : [];
  return new Map(rows.map((r) => [r.id, r]));
}

function categoriesById(db: DbOrTx, ids: readonly string[]) {
  const rows = ids.length > 0 ? db.select().from(financeCategories).where(inArray(financeCategories.id, [...new Set(ids)])).all() : [];
  return new Map(rows.map((r) => [r.id, r]));
}

function purposeExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.id, id)).get();
}

function purposeAbroad(db: DbOrTx, id: string): boolean {
  return db.select({ abroad: financePurposes.abroad }).from(financePurposes).where(eq(financePurposes.id, id)).get()?.abroad ?? false;
}

/** Finanzfelder eines Projekts, nur das Auslands-Flag — vorgabe `false` ohne Zeile (F2c Task 7). */
function projectAbroad(db: DbOrTx, id: string): boolean {
  return projectFinanceInternal(db, id).abroad;
}

function projectExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
}

function contactExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id)).get();
}

/**
 * Prüft die Settlements einer Geldzeile (Spec 5.3): Der Posten muss existieren
 * und darf nicht ohne Zahlung erledigt sein, die Summe darf den Betrag der
 * Zeile nicht übersteigen, und die Richtung muss stimmen — eine Verbindlichkeit
 * wird durch eine Ausgabe beglichen, eine Forderung durch eine Einnahme. Ein
 * Rück-Ausgleich (Spec Mitglieder und Lastschrift § 6.2) läuft umgekehrt und
 * zeigt auf einen festgeschriebenen Ausgleich desselben Postens
 * (`checkReversal`). `ownEntryId`: die Buchung, die gerade gespeichert wird —
 * ihre alten Zeilen zählen nicht mit.
 */
function checkSettlements(db: DbOrTx, line: { amountCents: number; settlements?: readonly MoneyLineSettlementInput[] }, ownEntryId: string | undefined): Failure | null {
  const settlements = line.settlements ?? [];
  if (settlements.length === 0) return null;
  const sum = settlements.reduce((s, x) => s + x.amountCents, 0);
  if (sum > Math.abs(line.amountCents)) return financeConflict('settlementExceedsLine');
  for (const settlement of settlements) {
    const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, settlement.openItemId)).get();
    if (!item) return notFound('financeOpenItem', settlement.openItemId);
    if (item.cancelledAt !== null) return financeConflict('openItemCancelled');
    const outflow = settlement.reversesSettlementId ? item.kind === 'receivable' : item.kind === 'payable';
    if (outflow && line.amountCents >= 0) return financeConflict('settlementWrongDirection');
    if (!outflow && line.amountCents <= 0) return financeConflict('settlementWrongDirection');
    if (settlement.reversesSettlementId) {
      const problem = checkReversal(db, { openItemId: settlement.openItemId, amountCents: settlement.amountCents, reversesSettlementId: settlement.reversesSettlementId }, ownEntryId);
      if (problem) return problem;
    }
  }
  return null;
}

/**
 * Ein Rück-Ausgleich zeigt auf einen gewöhnlichen Ausgleich desselben Postens an einer festgeschriebenen, nicht
 * zurückgenommenen Buchung (`reversalTargetInvalid`), und alle Rück-Ausgleiche darauf zusammen — aus Buchungen,
 * die nicht zurückgenommen sind, Entwürfe eingeschlossen — übersteigen dessen Betrag nicht (`reversalExceedsSettled`).
 */
export function checkReversal(db: DbOrTx, settlement: { openItemId: string; amountCents: number; reversesSettlementId: string }, ownEntryId: string | undefined): Failure | null {
  const target = db
    .select({ openItemId: financeOpenItemSettlements.openItemId, amountCents: financeOpenItemSettlements.amountCents, reversesSettlementId: financeOpenItemSettlements.reversesSettlementId, status: financeEntries.status, reversedByEntryId: financeEntries.reversedByEntryId })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(eq(financeOpenItemSettlements.id, settlement.reversesSettlementId))
    .get();
  if (!target || target.openItemId !== settlement.openItemId || target.reversesSettlementId !== null || target.status !== 'final' || target.reversedByEntryId !== null) return financeConflict('reversalTargetInvalid');
  const earlier = db
    .select({ amountCents: financeOpenItemSettlements.amountCents, entryId: financeEntries.id, reversedByEntryId: financeEntries.reversedByEntryId })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(eq(financeOpenItemSettlements.reversesSettlementId, settlement.reversesSettlementId))
    .all()
    .filter((r) => r.reversedByEntryId === null && r.entryId !== ownEntryId)
    .reduce((s, r) => s + r.amountCents, 0);
  if (earlier + settlement.amountCents > target.amountCents) return financeConflict('reversalExceedsSettled');
  return null;
}

/**
 * F4 Task 4: der Kontoumsatz einer Geldzeile muss existieren, aus einem nicht
 * verworfenen Auszug stammen, zu Konto, Vorzeichen und Betrag der Zeile
 * passen und darf höchstens einer nicht zurückgenommenen Buchung gehören.
 * `ownEntryId` ist die Buchung, die gerade gespeichert wird (beim erneuten
 * Speichern desselben Entwurfs zählt ihre eigene, alte Bindung nicht als
 * „bereits vergeben“) — bei `bookEntry` immer `undefined`, weil dort stets
 * eine neue Buchung entsteht.
 */
function checkRawTransaction(db: DbOrTx, line: { accountId: string; amountCents: number; rawTransactionId?: string | null }, ownEntryId: string | undefined): Failure | null {
  if (!line.rawTransactionId) return null;
  const raw = db.select().from(financeRawTransactions).where(eq(financeRawTransactions.id, line.rawTransactionId)).get();
  if (!raw) return notFound('financeRawTransaction', line.rawTransactionId);
  if (raw.accountId !== line.accountId || raw.amountCents !== line.amountCents) return financeConflict('rawTransactionMismatch');
  const run = db.select({ discardedAt: financeImportRuns.discardedAt }).from(financeImportRuns).where(eq(financeImportRuns.id, raw.runId)).get();
  if (run?.discardedAt) return financeConflict('rawTransactionDiscarded');
  const takenBy = db.select({ entryId: financeMoneyLines.entryId }).from(financeMoneyLines).where(and(eq(financeMoneyLines.rawTransactionId, raw.id), isNull(financeMoneyLines.rawReleasedAt))).get();
  if (takenBy && takenBy.entryId !== ownEntryId) return financeConflict('rawTransactionTaken');
  return null;
}

/**
 * Prüft, was eine Buchung ansteuert; ansonsten unverändert von `input`. Erst das Festschreiben prüft, ob es auch aktiv ist.
 * `presetTaxCodes`: Kennzeichen, die ein aufrufender Dienst als Vorgabe setzt (E-Rechnung, `applyInvoiceToDraft`).
 */
function checkReferences(deps: Deps, input: EntryLinesInput, presetTaxCodes: readonly TaxCode[] = []): Failure | null {
  const accounts = accountsById(deps.db, input.moneyLines.map((l) => l.accountId));
  for (const line of input.moneyLines) {
    if (!accounts.has(line.accountId)) return notFound('financeAccount', line.accountId);
    const settlementProblem = checkSettlements(deps.db, line, input.id);
    if (settlementProblem) return settlementProblem;
    const rawProblem = checkRawTransaction(deps.db, line, input.id);
    if (rawProblem) return rawProblem;
  }

  const categories = categoriesById(deps.db, input.allocationLines.map((l) => l.categoryId));
  for (const line of input.allocationLines) {
    if (!categories.has(line.categoryId)) return notFound('financeCategory', line.categoryId);
    if (line.contactId && !contactExists(deps.db, line.contactId)) return notFound('contact', line.contactId);
    if (line.projectId && !projectExists(deps.db, line.projectId)) return notFound('project', line.projectId);
    if (line.directDebitItemId && !deps.db.select({ id: financeDirectDebitItems.id }).from(financeDirectDebitItems).where(eq(financeDirectDebitItems.id, line.directDebitItemId)).get()) return notFound('financeDirectDebitItem', line.directDebitItemId);
    if (line.purposeId && !purposeExists(deps.db, line.purposeId)) return notFound('financePurpose', line.purposeId);
  }
  return gemAttributeProblem(input.allocationLines, categories) ?? taxCodeProblem(deps.db, input, categories, presetTaxCodes) ?? serviceDateProblem(deps.db, input.allocationLines, categories);
}

/** Die Kennzeichen aus den Zeilenvorlagen der offenen Posten, die die Geldzeilen ausgleichen — dort steht die E-Rechnung. */
function openItemTemplateTaxCodes(db: DbOrTx, moneyLines: EntryLinesInput['moneyLines']): string[] {
  const ids = [...new Set(moneyLines.flatMap((l) => (l.settlements ?? []).map((s) => s.openItemId)))];
  if (ids.length === 0) return [];
  return db.select({ lineTemplate: financeOpenItems.lineTemplate }).from(financeOpenItems).where(inArray(financeOpenItems.id, ids)).all().flatMap((row) => {
    if (!row.lineTemplate) return [];
    try {
      const parsed: unknown = JSON.parse(row.lineTemplate);
      return Array.isArray(parsed) ? parsed.flatMap((t: unknown) => (t && typeof t === 'object' && typeof (t as { taxCode?: unknown }).taxCode === 'string' ? [(t as { taxCode: string }).taxCode] : [])) : [];
    } catch {
      return [];
    }
  });
}

/**
 * Befund 39, Frage 4: Ein ausdrücklich gesetztes Kennzeichen muss am Buchungstag zur Auswahl gehören
 * (`taxCodeOptionsInternal`, dieselbe wie in der Maske) — über Oberfläche und MCP gleich. Keine Wahl und deshalb
 * erlaubt: `none` und die Vorgabe der Kategorie (dasselbe wie ein leeres Feld); dazu was schon da war oder vorgegeben
 * ist: ein Kennzeichen, das schon an einer Zeile dieses Entwurfs stand (Bestand), das der Ursprungszeile einer Rückgabe
 * oder Erstattung, die Vorgabe vom Kontakt (Merkmal § 13b an einer Ausgabe) und die der E-Rechnung (Zeilenvorlage des
 * ausgeglichenen offenen Postens oder `presetTaxCodes`).
 */
function taxCodeProblem(db: DbOrTx, input: EntryLinesInput, categories: ReadonlyMap<string, { defaultTaxCode: string }>, presetTaxCodes: readonly TaxCode[]): Failure | null {
  const chosen = input.allocationLines.map((l, i) => ({ l, i })).filter(({ l }) => l.taxCode && l.taxCode !== 'none' && l.taxCode !== categories.get(l.categoryId)?.defaultTaxCode);
  if (chosen.length === 0) return null;
  const allowed = new Set<string>([...taxCodeOptionsInternal(db, input.entryDate), ...presetTaxCodes, ...openItemTemplateTaxCodes(db, input.moneyLines)]);
  if (input.id) for (const row of db.select({ taxCode: financeAllocationLines.taxCode }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, input.id)).all()) allowed.add(row.taxCode);
  for (const { l, i } of chosen) {
    const code = l.taxCode!;
    if (allowed.has(code) || presetByLine(db, l, code)) continue;
    // N10: `rc13bEu` fehlt nur ohne Unternehmereigenschaft und ohne USt-IdNr. — der eigene Grund (§ 3a Abs. 2 S. 3 UStG).
    return invalid([{ path: `allocationLines.${i}.taxCode`, message: code === 'rc13bEu' ? 'rc13bEuNeedsVatId' : 'taxCodeNotOffered' }]);
  }
  return null;
}

/** Vorgegeben statt gewählt: die Vorgabe vom Kontakt (Merkmal § 13b an einer Ausgabe) oder das Kennzeichen der Ursprungszeile. */
function presetByLine(db: DbOrTx, l: { amountCents: number; contactId?: string | null; originLineId?: string | null }, code: string): boolean {
  if (l.amountCents < 0 && l.contactId && contactReverseChargeCode(db, l.contactId) === code) return true;
  return !!l.originLineId && db.select({ taxCode: financeAllocationLines.taxCode }).from(financeAllocationLines).where(eq(financeAllocationLines.id, l.originLineId)).get()?.taxCode === code;
}

/** N11 a: eine Zeile, deren Kennzeichen der Buchungstag nicht anbietet. */
export interface TaxCodeNotOfferedNotice { lineId: string; taxCode: TaxCode }

/**
 * Ohne Rechteprüfung, N11 a (Joe 2026-10-27): die Zeilen einer Buchung, deren Kennzeichen die Auswahl des Buchungstags
 * (`taxCodeOptionsInternal`) nicht anbietet und das weder die Vorgabe der Kategorie noch die vom Kontakt oder der
 * Ursprungszeile ist — also nur erlaubt war, weil es schon am Entwurf stand (`taxCodeProblem`), etwa weil sich die
 * Umsatzsteuer-Einstellungen seitdem geändert haben. Für den Hinweis beim Festschreiben, keine Sperre.
 */
export function taxCodesNotOfferedInternal(db: DbOrTx, entry: { entryDate: string; allocationLines: readonly { id: string; taxCode: string; categoryId: string; amountCents: number; contactId: string | null; originLineId: string | null }[] }): TaxCodeNotOfferedNotice[] {
  const coded = entry.allocationLines.filter((l) => l.taxCode !== 'none');
  if (coded.length === 0) return [];
  const offered = new Set<string>(taxCodeOptionsInternal(db, entry.entryDate));
  const defaults = new Map(db.select({ id: financeCategories.id, defaultTaxCode: financeCategories.defaultTaxCode }).from(financeCategories).where(inArray(financeCategories.id, [...new Set(coded.map((l) => l.categoryId))])).all().map((c) => [c.id, c.defaultTaxCode] as const));
  return coded.filter((l) => !offered.has(l.taxCode) && defaults.get(l.categoryId) !== l.taxCode && !presetByLine(db, l, l.taxCode)).map((l) => ({ lineId: l.id, taxCode: l.taxCode as TaxCode }));
}

/**
 * Ohne Rechteprüfung, N20 (Joe 2026-10-27): Fließen mit der Buchung Mittel an Partner ab (Ausgabezeile auf einer
 * Kategorie der Mittelweitergabe, `PARTNER_GRANT_CATEGORY_KEYS`), ohne dass sie zu einer Zahlung an Partner gehört — kein
 * beglichener Posten mit Herkunft `financePartnerPayment`, keine Zeile als bezahlte Zeile einer Zahlung? Dann verfolgt
 * Kompass keinen Verwendungsnachweis (§ 58 Nr. 1 AO). Für den Hinweis beim Festschreiben, keine Sperre.
 */
export function partnerPaymentMissingInternal(db: DbOrTx, entryId: string): boolean {
  const lines = db.select({ id: financeAllocationLines.id, amountCents: financeAllocationLines.amountCents, key: financeCategories.key }).from(financeAllocationLines).innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId)).where(eq(financeAllocationLines.entryId, entryId)).all();
  const grants = lines.filter((l) => l.amountCents < 0 && l.key !== null && PARTNER_GRANT_CATEGORY_KEYS.includes(l.key));
  if (grants.length === 0) return false;
  if (db.select({ id: financePartnerPaidLines.id }).from(financePartnerPaidLines).where(inArray(financePartnerPaidLines.paidLineId, grants.map((l) => l.id))).get()) return false;
  const moneyLineIds = db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).all().map((l) => l.id);
  if (moneyLineIds.length === 0) return true;
  const settled = db
    .select({ originType: financeOpenItems.originType })
    .from(financeOpenItemSettlements)
    .innerJoin(financeOpenItems, eq(financeOpenItems.id, financeOpenItemSettlements.openItemId))
    .where(and(inArray(financeOpenItemSettlements.moneyLineId, moneyLineIds), eq(financeOpenItems.originType, 'financePartnerPayment')))
    .get();
  return !settled;
}

/**
 * Rechenschaft D2: Erbschaften (§ 62 Abs. 3 Nr. 1 AO) und erhaltene Vermögensausstattungen (§ 58 Nr. 3 AO, § 62 Abs. 3
 * Nr. 2 AO) gehen nach Vorgabe ins Vermögen. Abgewählt nur mit dem Grund ihrer Art (Recherche 2026-10-25, Frage 3:
 * AEAO zu § 62 Nr. 16 „können“) — der Grund passt nur zu seiner Art.
 */
const OPT_OUT_OF: Record<AddsToAssetsOptOut, 'inheritance' | 'endowment'> = { testatorDirectedCurrentUse: 'inheritance', donorAllowedCurrentUse: 'endowment' };

function addsToAssetsByDefault(incomeKind: string | null, assetEndowment: boolean): boolean {
  return incomeKind === 'inheritance' || assetEndowment;
}

function gemAttributeProblem(lines: EntryLinesInput['allocationLines'], categories: ReadonlyMap<string, { incomeKind: string | null; direction: string }>): Failure | null {
  for (const [i, line] of lines.entries()) {
    const category = categories.get(line.categoryId)!;
    const endowment = line.assetEndowment === true;
    if (endowment && (category.direction !== 'income' || category.incomeKind !== 'bodyGrant' || !line.contactId)) return invalid([{ path: `allocationLines.${i}.assetEndowment`, message: 'notApplicable' }]);
    const kind = category.incomeKind === 'inheritance' ? 'inheritance' : endowment ? 'endowment' : null;
    const adds = line.addsToAssets ?? addsToAssetsByDefault(category.incomeKind, endowment);
    const optOut = line.addsToAssetsOptOut ?? null;
    if (optOut !== null && (adds || OPT_OUT_OF[optOut] !== kind)) return invalid([{ path: `allocationLines.${i}.addsToAssetsOptOut`, message: 'notApplicable' }]);
    if (kind !== null && !adds && optOut === null) return invalid([{ path: `allocationLines.${i}.addsToAssetsOptOut`, message: 'required' }]);
  }
  return null;
}

/** Bargeld wird am selben Tag festgehalten: Ein Entwurf auf einem Barkonto lässt sich nicht parken (Spec 5.4). Nur `saveDraft` fragt das — `bookEntry` ist der Weg dafür. */
function cashLineProblem(deps: Deps, moneyLines: readonly { accountId: string }[]): Failure | null {
  const accounts = accountsById(deps.db, moneyLines.map((l) => l.accountId));
  if ([...accounts.values()].some((a) => a.kind === 'cash')) return financeConflict('cashDraftNotAllowed');
  return null;
}

/**
 * E6a: Merkmal „Rechnungen mit Umkehr der Steuerschuld (§ 13b)“ am Kontakt (`finance_contact_tax_details`, aus der
 * Tabelle gelesen: `ledger/` kennt `allocation/` nicht) — Vorgabe `rc13bEu`/`rc13bOther` für Ausgaben.
 */
export function contactReverseChargeCode(db: DbOrTx, contactId: string): TaxCode | null {
  const row = db.select({ reverseCharge: financeContactTaxDetails.reverseCharge }).from(financeContactTaxDetails).where(eq(financeContactTaxDetails.contactId, contactId)).get();
  return row?.reverseCharge === 'eu' ? 'rc13bEu' : row?.reverseCharge === 'other' ? 'rc13bOther' : null;
}

/** Das Kennzeichen der Zeile: ausdrücklich gesetzt, sonst bei einer Ausgabe vom Kontakt (§ 13b), sonst von der Kategorie. */
function effectiveTaxCode(db: DbOrTx, line: Pick<EntryLinesInput['allocationLines'][number], 'taxCode' | 'amountCents' | 'contactId'>, category: { defaultTaxCode: string }): TaxCode {
  if (line.taxCode) return line.taxCode;
  if (line.amountCents < 0 && line.contactId) {
    const fromContact = contactReverseChargeCode(db, line.contactId);
    if (fromContact) return fromContact;
  }
  return category.defaultTaxCode as TaxCode;
}

/** Ein Leistungsdatum nur an Zeilen mit § 13b-/Erwerbskennzeichen (Spec E6 Teil 2). */
function serviceDateProblem(db: DbOrTx, lines: EntryLinesInput['allocationLines'], categories: ReadonlyMap<string, { defaultTaxCode: string }>): Failure | null {
  for (const [i, line] of lines.entries()) {
    if (!line.serviceDate) continue;
    const code = effectiveTaxCode(db, line, categories.get(line.categoryId)!);
    if (!(REVERSE_CHARGE_CODES as readonly string[]).includes(code)) return invalid([{ path: `allocationLines.${i}.serviceDate`, message: 'notApplicable' }]);
  }
  return null;
}

function resolvedLines(deps: Deps, input: EntryLinesInput): { moneyLines: MoneyLineWrite[]; allocationLines: AllocationLineWrite[] } {
  const categories = categoriesById(deps.db, input.allocationLines.map((l) => l.categoryId));
  return {
    moneyLines: input.moneyLines.map((l) => ({ accountId: l.accountId, amountCents: l.amountCents, settlements: l.settlements, rawTransactionId: l.rawTransactionId ?? null })),
    allocationLines: input.allocationLines.map((l) => {
      const category = categories.get(l.categoryId)!;
      return {
        categoryId: l.categoryId,
        amountCents: l.amountCents,
        taxCode: effectiveTaxCode(deps.db, l, category),
        rateKind: l.rateKind ?? 'standard',
        projectId: l.projectId ?? null,
        purposeId: l.purposeId ?? null,
        contactId: l.contactId ?? null,
        abroad: l.abroad ?? ((l.purposeId ? purposeAbroad(deps.db, l.purposeId) : false) || (l.projectId ? projectAbroad(deps.db, l.projectId) : false)),
        originLineId: l.originLineId ?? null,
        addsToAssets: l.addsToAssets ?? addsToAssetsByDefault(category.incomeKind, l.assetEndowment === true),
        addsToAssetsOptOut: l.addsToAssetsOptOut ?? null,
        assetEndowment: l.assetEndowment ?? false,
        directDebitItemId: l.directDebitItemId ?? null,
        serviceDate: l.serviceDate ?? null,
      };
    }),
  };
}

/** Für `bookEntry` (finalize.ts): dieselbe Prüfung und Vorbelegung wie `saveDraft`, ohne die Bargeld-Sperre — Bargeld bucht `bookEntry` gerade deshalb in einem Zug. */
export function resolveEntryLines(deps: Deps, input: EntryLinesInput, presetTaxCodes: readonly TaxCode[] = []): Result<{ moneyLines: MoneyLineWrite[]; allocationLines: AllocationLineWrite[] }> {
  const problem = checkReferences(deps, input, presetTaxCodes);
  if (problem) return problem;
  return ok(resolvedLines(deps, input));
}

/** `finance.entriesWrite`: Entwurf anlegen (ohne `id`) oder als Ganzes ersetzen (mit `id`). Ein Entwurf darf unausgeglichen und leer sein. */
export async function saveDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  return saveDraftWithPresets(deps, ctx, input, []);
}

/** `saveDraft` mit Kennzeichen, die der aufrufende Dienst als Vorgabe setzt (E-Rechnung, `applyInvoiceToDraft`). */
export async function saveDraftWithPresets(deps: Deps, ctx: CallContext, input: unknown, presetTaxCodes: readonly TaxCode[]): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, entryLinesSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  let before: EntryView | null = null;
  if (v.id) {
    before = entryViewInternal(deps.db, v.id);
    if (!before) return notFound('financeEntry', v.id);
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
    if (before.status !== 'draft') return financeConflict('entryNotDraft', { number: before.number ?? before.id });
  }

  const cashProblem = cashLineProblem(deps, v.moneyLines);
  if (cashProblem) return cashProblem;
  const resolved = resolveEntryLines(deps, v, presetTaxCodes);
  if (!resolved.ok) return resolved;
  const lines = resolved.value;
  const boardProblem = boardAllowanceProblemInternal(deps.db, deps, { entryDate: v.entryDate, reason: v.reason, lines: v.allocationLines });
  if (boardProblem) return boardProblem;
  const boardAllowanceReason = boardAllowanceProblemInternal(deps.db, deps, { entryDate: v.entryDate, reason: null, lines: v.allocationLines }) ? v.reason!.trim() : null;
  // Befund Q: kein Verbot am Entwurf — die Begründung wird hier gespeichert und beim Festschreiben verlangt.
  const purposeNegativeReason = v.reason?.trim() && purposeGoingNegative(deps.db, v.allocationLines) ? v.reason.trim() : null;

  return deps.db.transaction((tx: DbOrTx): Result<EntryView> => {
    // Befund 10 (Task 2, Spec 5.1): ein Entwurf läuft wie das Festschreiben durch `ensureFiscalYearFor` —
    // vor dem ersten Geschäftsjahr wird nichts gespeichert, im unmittelbaren Folgejahr entsteht es hier schon.
    const yearResult = ensureFiscalYearFor(tx, deps, ctx, v.entryDate);
    if (!yearResult.ok) return yearResult;

    const now = isoNow(deps.clock);
    const id = before?.id ?? newId();
    if (before) {
      tx.update(financeEntries)
        .set({ entryDate: v.entryDate, text: v.text, boardAllowanceReason, purposeNegativeReason, reviewedAt: null, reviewedByUserId: null, reviewedChannel: null, updatedAt: now })
        .where(eq(financeEntries.id, id))
        .run();
    } else {
      tx.insert(financeEntries)
        .values({ id, number: null, entryDate: v.entryDate, text: v.text, boardAllowanceReason, purposeNegativeReason, status: 'draft', createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel, createdAt: now, updatedAt: now })
        .run();
    }
    writeLinesInternal(tx, id, lines);
    const after = entryViewInternal(tx, id, todayIn(deps))!;
    financeAudit(tx, deps, ctx, { action: 'finance.entry.draftSave', entity: 'financeEntry', id, after: auditSnapshot(after, ctx) });
    return ok(after);
  });
}

/** `finance.read`: eine Buchung tritt mit Text und Kontakt auf — Übersicht genügt nicht (Spec 10.1). */
export async function getEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const view = entryViewInternal(deps.db, parsed.value.id, todayIn(deps));
  if (!view) return notFound('financeEntry', parsed.value.id);
  return ok({ ...view, mayBeReturn: mayBeDonationReturnInternal(deps, view.id) });
}

/**
 * Was das Journal zusätzlich zur `EntryView` braucht (Befund 21/23) — nur
 * gesetzt, wo es zutrifft: `accountAmountCents`/`runningBalanceCents` mit
 * Kontofilter (Betrag und laufender Saldo auf diesem Konto), sonst bei einer
 * Buchung ohne Zuordnungszeilen `movedCents`/`transfer` (Umbuchung zwischen
 * eigenen Konten, ohne Vorzeichen der Journal-Summe).
 */
export type JournalEntryView = EntryView & {
  accountAmountCents?: number;
  runningBalanceCents?: number | null;
  movedCents?: number;
  transfer?: boolean;
};

export async function listEntries(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ entries: JournalEntryView[]; total: number; totals: { incomeCents: number; expenseCents: number; resultCents: number } }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const f = parsed.value;

  const conditions: SQL[] = [];
  if (f.status) conditions.push(eq(financeEntries.status, f.status));
  if (f.state) {
    if (f.state === 'draft') conditions.push(and(eq(financeEntries.status, 'draft'), isNull(financeEntries.reviewedAt))!);
    else if (f.state === 'reviewed') conditions.push(and(eq(financeEntries.status, 'draft'), isNotNull(financeEntries.reviewedAt))!);
    else if (f.state === 'final') conditions.push(and(eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId))!);
    else conditions.push(and(eq(financeEntries.status, 'final'), isNotNull(financeEntries.reversedByEntryId))!);
  }
  if (f.fiscalYearId) conditions.push(eq(financeEntries.fiscalYearId, f.fiscalYearId));
  if (f.from) conditions.push(gte(financeEntries.entryDate, f.from));
  if (f.to) conditions.push(lte(financeEntries.entryDate, f.to));
  if (f.agentPrepared) conditions.push(eq(financeEntries.createdChannel, 'mcp'));
  if (f.ids) conditions.push(inArray(financeEntries.id, f.ids));
  if (f.accountId) {
    const ids = deps.db.select({ id: financeMoneyLines.entryId }).from(financeMoneyLines).where(eq(financeMoneyLines.accountId, f.accountId)).all().map((r) => r.id);
    conditions.push(inArray(financeEntries.id, ids.length > 0 ? ids : ['—']));
  }
  if (f.categoryId) {
    const ids = deps.db.select({ id: financeAllocationLines.entryId }).from(financeAllocationLines).where(eq(financeAllocationLines.categoryId, f.categoryId)).all().map((r) => r.id);
    conditions.push(inArray(financeEntries.id, ids.length > 0 ? ids : ['—']));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const allIds = deps.db.select({ id: financeEntries.id }).from(financeEntries).where(where).orderBy(desc(financeEntries.entryDate), desc(financeEntries.createdAt)).all().map((r) => r.id);
  // Mengen sind klein (Vereinsbuchhaltung): Text-/Betrags- und Belegsuche laufen über die schon geladene Sicht, nicht über weitere SQL-Abfragen.
  const today = todayIn(deps);
  let views = allIds.map((id) => entryViewInternal(deps.db, id, today)!);

  if (f.text) {
    const q = f.text.toLowerCase();
    const amountCents = parseSearchAmountCents(f.text);
    views = views.filter((v) => {
      if (v.text.toLowerCase().includes(q)) return true;
      if (v.number?.toLowerCase().includes(q)) return true;
      if (amountCents !== null) {
        if (v.moneyLines.some((l) => Math.abs(l.amountCents) === amountCents)) return true;
        if (v.allocationLines.some((l) => Math.abs(l.amountCents) === amountCents)) return true;
      }
      return false;
    });
  }
  if (f.withoutVoucher) views = views.filter((v) => v.documentation.state === 'missing');

  if (f.orderBy) {
    const { field, direction } = f.orderBy;
    const dir = direction === 'asc' ? 1 : -1;
    if (field === 'number') {
      // Entwürfe ohne Nummer sortieren immer zuletzt, unabhängig von der Richtung.
      views = [...views].sort((a, b) => {
        if (a.number === null && b.number === null) return 0;
        if (a.number === null) return 1;
        if (b.number === null) return -1;
        return dir * a.number.localeCompare(b.number);
      });
    } else if (field === 'entryDate') {
      views = [...views].sort((a, b) => dir * a.entryDate.localeCompare(b.entryDate));
    } else if (field === 'text') {
      views = [...views].sort((a, b) => dir * a.text.localeCompare(b.text));
    } else {
      views = [...views].sort((a, b) => dir * (amountSortKey(a) - amountSortKey(b)));
    }
  }

  const total = views.length;
  const totals = totalsOf(deps.db, views);
  const page = views.slice(f.offset, f.offset + f.limit);

  let entries: JournalEntryView[];
  if (f.accountId) {
    // Kontoblatt (Befund 21/23): Betrag und laufender Saldo auf diesem Konto — nie die Buchungssumme.
    const runningByEntryId = new Map(accountLedgerInternal(deps.db, f.accountId).map((l) => [l.entryId, l.runningBalanceCents]));
    entries = page.map((v) => ({
      ...v,
      accountAmountCents: v.moneyLines.filter((l) => l.accountId === f.accountId).reduce((s, l) => s + l.amountCents, 0),
      runningBalanceCents: v.status === 'final' ? (runningByEntryId.get(v.id) ?? null) : null,
    }));
  } else {
    entries = page.map((v) => {
      if (v.allocationLines.length > 0 || v.moneyLines.length === 0) return v;
      const positive = v.moneyLines.find((l) => l.amountCents > 0);
      if (!positive) return v;
      return { ...v, movedCents: positive.amountCents, transfer: true };
    });
  }
  return ok({ entries, total, totals });
}

/**
 * Die eigentliche Löschung eines Entwurfs, in einer bereits offenen
 * Transaktion — von `deleteDraft` **und** vom Verwerfen eines Auszugs
 * (`import/discard.ts`, F4 Task 5) genutzt: Ein verworfener Lauf löscht auch
 * seine Entwürfe, auch geprüfte (Spec 6.1). Belegzeilen gehen mit dem
 * Entwurf; der Bezug in der Akte wird gelöst, das Dokument selbst bleibt dort
 * liegen.
 */
export function deleteDraftInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, before: EntryView): void {
  const voucherLinks = tx.select({ documentId: financeEntryDocuments.documentId }).from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, before.id)).all();
  for (const link of voucherLinks) {
    if (link.documentId) unlinkDocumentInternal(tx, { documentId: link.documentId, entityType: 'financeEntry', entityId: before.id });
  }
  tx.delete(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, before.id)).run();
  // N1: Was nur am Entwurf hängt, geht mit ihm — Ausgleiche offener Posten (der Posten ist danach wieder offen) und
  // Angaben zu Sachspenden. Alles andere, was auf Buchung oder Zeilen zeigt (Kennzeichnungen, Begründungen,
  // Bestätigungen, Zahlungen an Partner, Auslagen, Kassenzählungen), gibt es nur an festgeschriebenen Buchungen.
  const moneyLineIds = before.moneyLines.map((l) => l.id);
  if (moneyLineIds.length > 0) tx.delete(financeOpenItemSettlements).where(inArray(financeOpenItemSettlements.moneyLineId, moneyLineIds)).run();
  const allocationLineIds = before.allocationLines.map((l) => l.id);
  if (allocationLineIds.length > 0) tx.delete(financeInKindDetails).where(inArray(financeInKindDetails.lineId, allocationLineIds)).run();
  tx.delete(financeAllocationLines).where(eq(financeAllocationLines.entryId, before.id)).run();
  tx.delete(financeMoneyLines).where(eq(financeMoneyLines.entryId, before.id)).run();
  tx.delete(financeEntries).where(eq(financeEntries.id, before.id)).run();
  financeAudit(tx, deps, ctx, { action: 'finance.entry.draftDelete', entity: 'financeEntry', id: before.id, before: auditSnapshot(before, ctx) });
}

/** `finance.entriesWrite`: ein Entwurf wird gelöscht, nicht storniert (Spec 5.4). */
export async function deleteDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const before = entryViewInternal(deps.db, parsed.value.id);
  if (!before) return notFound('financeEntry', parsed.value.id);
  if (before.status !== 'draft') return financeConflict('entryNotDraft', { number: before.number ?? before.id });

  return deps.db.transaction((tx: DbOrTx) => {
    deleteDraftInternal(tx, deps, ctx, before);
    return ok({ id: before.id });
  });
}

/**
 * `finance.entriesWrite`, **`humanOnly`**: Ein Mensch bestätigt den Entwurf.
 * Ein Agent bereitet vor, ein Mensch prüft — über MCP verweigert, bis der
 * Verein `finance.mcpHumanOnlyAllowed` an der Oberfläche gesetzt hat (E10).
 */
export async function setReviewed(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, reviewSchema, input);
  if (!parsed.ok) return parsed;
  const before = entryViewInternal(deps.db, parsed.value.id);
  if (!before) return notFound('financeEntry', parsed.value.id);
  if (before.status !== 'draft') return financeConflict('entryNotDraft', { number: before.number ?? before.id });
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeEntries)
      .set({ reviewedAt: parsed.value.reviewed ? now : null, reviewedByUserId: parsed.value.reviewed ? ctx.userId : null, reviewedChannel: parsed.value.reviewed ? ctx.channel : null, updatedAt: now })
      .where(eq(financeEntries.id, before.id))
      .run();
    const after = entryViewInternal(tx, before.id, todayIn(deps))!;
    financeAudit(tx, deps, ctx, { action: 'finance.entry.review', entity: 'financeEntry', id: before.id, after: { ...auditSnapshot(after, ctx), reviewed: parsed.value.reviewed }, params: { reviewed: parsed.value.reviewed } });
    return ok(after);
  });
}
