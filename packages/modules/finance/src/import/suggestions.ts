import { isoDay, notFound, ok, paperDate, readSetting, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import type { EntryLinesInput } from '../ledger/entries';
import { openCentsInternal } from '../ledger/open-items';
import {
  financeAccounts, financeAllocationLines, financeCategories, financeDirectDebitItems, financeDirectDebitRuns, financeSepaMandates, financeEntries, financeImportRuns, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, financePledges, financePurposes, financeRawTransactions,
  type FinanceAllocationLineRow, type FinanceDirectDebitItemRow, type FinanceDirectDebitRunRow, type FinanceCategoryRow, type FinanceImportRuleRow, type FinanceOpenItemRow, type FinancePurposeRow, type FinanceRawTransactionRow,
} from '../schema';
import { contactChannels, contacts, displayName } from '@kompass/module-contacts';
import { contactForIbanInternal, contactsForIbanInternal } from './contact-ibans';
import { activeImportRulesInternal } from './rules';
import { daysApart, findPair, isCashKeyword } from './suggest/pair';
import { findByReference } from './suggest/reference';
import { findRunsForCredit } from './suggest/direct-debit';
import { creditLinesOfItemInternal, takenItemIdsInternal } from '../direct-debit/booking';
import { isReturnFeeLine } from '../direct-debit/return-fee';
import { unreturnedRunItemsInternal } from '../direct-debit/run-items';
import { findReturnedItem, findReturnOrigin, findReturnOriginsByName } from './suggest/return';
import { ruleMatches } from '../rules-pure';
import { paymentServiceHint } from './suggest/text';

/**
 * Vorschläge der Arbeitsliste (F5, Spec 6.4): Jeder offene Kontoumsatz bekommt
 * genau einen Vorschlag, und jeder Vorschlag nennt seine Herkunft. Die
 * Reihenfolge ist fest — (0) passt zu einer vorhandenen Buchung, (1) Umbuchung
 * zwischen eigenen Konten oder gegen die Barkasse, (2) zurückgegebene Zahlung,
 * Gutschrift eines Einzugs (Plan L3), (3) offene Zahlung, (4) Regel, (5) Kontakt über die IBAN —, die erste, die
 * greift, gewinnt. Die Regeln selbst sind rein (`suggest/`); hier werden sie
 * mit Daten gefüttert. Der Dienst liest nur.
 */
export type SuggestionKind = 'linkEntry' | 'transfer' | 'cashTransfer' | 'return' | 'fee' | 'directDebitRun' | 'openItem' | 'rule' | 'contact' | 'none';

export interface SuggestionReason {
  kind: 'linkEntry' | 'cashTransferEntry' | 'pair' | 'cashKeyword' | 'returnCode' | 'directDebitReturn' | 'relatedReference' | 'paymentFee' | 'directDebitReturnFee' | 'directDebitRun' | 'paymentReference' | 'amountAndContact' | 'rule' | 'contactIban' | 'contactEmail' | 'contactName' | 'sharedIban';
  entryNumber?: string | null;
  entryId?: string;
  ruleId?: string;
  ruleName?: string;
  openItemId?: string;
  paymentReference?: string | null;
  contactId?: string;
  otherAccountId?: string;
  /** Bei `pair`: der Gegen-Umsatz auf dem anderen Konto — `bookFromTransaction` bindet ihn als zweite Geldzeile. */
  otherRawTransactionId?: string;
  /** Befund 30a: bei `returnCode` ohne IBAN und mehreren gleichlautenden Namen — die Rückfrage statt eines Vorschlags. */
  returnCandidates?: { entryId: string; entryNumber: string | null }[];
  /** Befund Z: bei `paymentReference` mit mehreren gleich passenden Posten — alle, statt „sicher“ den ersten. */
  openItemCandidates?: { openItemId: string; itemDate: string; openCents: number }[];
  /** Plan L3, bei `directDebitRun`: der Einzug, dessen Gutschrift der Umsatz ist; bei `directDebitReturn` der Einzug des zurückgegebenen Postens. */
  runId?: string;
  collectionDate?: string;
  /** Plan L3, bei `directDebitReturn`: der Rückgabe-Code der Bank (Klartext über `RETURN_CODES`). */
  returnCode?: string | null;
  /** Plan L3, Review Focus 4: mehrere Einzüge passen gleich gut — alle, statt „sicher“ den ersten. */
  runCandidates?: { runId: string; collectionDate: string; sumCents: number }[];
  /**
   * Plan U2 (Handoff 2a § 1.6), bei `directDebitRun`/`directDebitReturn`: woran der Umsatz erkannt ist — End-to-End-ID,
   * Mandatsreferenz und Betrag (Rückgabe) oder die Summe des Einzugs (Sammelgutschrift).
   */
  matchedBy?: 'endToEnd' | 'mandateAndAmount' | 'sum';
  /** Bei `directDebitRun`: Zahl der Posten; bei beiden: das Entgelt der Bank, das eine Gebührenzeile wird. */
  itemCount?: number;
  feeCents?: number;
  /**
   * Plan U4 Task 3 (Joe 2026-10-19), bei `sharedIban`: die aktiven Kontakte eines Gemeinschaftskontos — der Grund nennt
   * immer beide; vorbelegt ist ein Kontakt nur, wenn genau einer einen passenden offenen Posten hat (968500b9).
   */
  contactIds?: string[];
  /** Bei `directDebitReturn`: der zurückgegebene Posten — Beitrag (wird wieder offen) oder Rate (wird „zurückgegeben“). */
  returnedItem?: { source: 'openItem' | 'pledge'; installmentOn: string | null; debtorName: string; amountCents: number };
}

export interface SuggestionDraft {
  entryDate: string;
  text: string;
  moneyLines: EntryLinesInput['moneyLines'];
  allocationLines: EntryLinesInput['allocationLines'];
}

export interface SuggestionView {
  rawTransactionId: string;
  kind: SuggestionKind;
  /** Befund 30a: `possible` liegt zwischen beiden — ein Name statt einer IBAN, nie „sicher“. */
  confidence: 'sure' | 'unsure' | 'possible';
  reasons: SuggestionReason[];
  /** Vorbelegung für `bookFromTransaction` — `null` bei `linkEntry` und `none`. */
  draft: SuggestionDraft | null;
  linkEntry: { entryId: string; number: string | null; entryDate: string; status: 'draft' | 'final' } | null;
  /**
   * `inSubmittedRun` (M17): Der Posten steckt in einem eingereichten Einzug — die Bank zieht ihn trotzdem ein.
   * `overpaid` (E4, M16): Der Umsatz übersteigt den offenen Betrag; der Rest steht als Zeile ohne Kategorie da.
   */
  problems: ('categoryInactive' | 'purposeClosed' | 'inSubmittedRun' | 'overpaid' | 'paidOtherwise')[];
  /**
   * Die Werte zu den Problemen, die einen Tag oder Betrag nennen (Plan N1 Task 2). `paidOtherwise` (U5, Plan N3): die
   * Gutschrift eines Einzugs trägt Posten, die inzwischen anders bezahlt sind — die Bank hat sie doppelt eingezogen.
   */
  problemParams: {
    inSubmittedRun?: { date: string };
    overpaid?: { amountCents: number };
    paidOtherwise?: { count: number; amountCents: number; items: { directDebitItemId: string; openItemId: string; amountCents: number }[] };
  };
  /** `originIsDraft` (Befund 37): die zurückgegebene Zahlung ist noch nicht festgeschrieben. */
  hints: ('foreignIban' | 'originIsDraft')[];
}

/** Die Kategorie einer Gebührenzeile beim Paar (Startplan). */
const FEE_CATEGORY_KEY = 'payment-fees';
/** Plan L3: die Kategorie der Entgelte, die eine Bank von einer Sammelgutschrift abzieht (Startplan). */
const BANK_FEE_CATEGORY_KEY = 'bank-fees';
/** Plan L3: eine Rate wird als Spende gebucht (Startplan). */
const DONATION_CATEGORY_KEY = 'donations';
/** Vorgabe-Kategorie, wenn nur der Kontakt bekannt ist und Geld hereinkommt (Plan F5, Vorschlag 5). */
const CONTACT_INCOME_CATEGORY_KEY = 'donations';

interface UnboundLine {
  lineId: string;
  entryId: string;
  number: string | null;
  entryDate: string;
  status: 'draft' | 'final';
  accountId: string;
  amountCents: number;
}

interface OpenItemLike {
  row: FinanceOpenItemRow;
  openCents: number;
}

/** Einmal geladen, für jeden Umsatz benutzt — die Arbeitsliste fragt alle offenen auf einmal. */
interface SuggestionData {
  settings: { matchDays: number; feeToleranceCents: number; matchEntryDays: number; cashKeywords: readonly string[] };
  openRaws: FinanceRawTransactionRow[];
  /** (0): Kontoumsatz → die Buchungszeile, die er für sich beansprucht (Review Focus 1). */
  linkClaims: Map<string, UnboundLine>;
  openItems: OpenItemLike[];
  rules: FinanceImportRuleRow[];
  categories: Map<string, FinanceCategoryRow>;
  categoriesByKey: Map<string, FinanceCategoryRow>;
  purposes: Map<string, FinancePurposeRow>;
  cashAccountIds: string[];
  paymentServiceAccountIds: string[];
  /** Plan L3: eingereichte Einzüge, deren Posten noch keine Buchung trägt. */
  directDebit: DirectDebitData;
}

interface DirectDebitData {
  /** Freie Posten nach End-to-End-ID. */
  byEndToEnd: Map<string, { item: FinanceDirectDebitItemRow; run: FinanceDirectDebitRunRow }>;
  /** Eingereichte Einzüge, von denen noch kein Posten gebucht ist — für eine Sammelgutschrift. */
  runs: { id: string; accountId: string; collectionDate: string; sumCents: number; items: FinanceDirectDebitItemRow[] }[];
}

function loadDirectDebitDataInternal(db: DbOrTx): DirectDebitData {
  // Auch Einzüge mit Datei, die nie als eingereicht vermerkt sind (verfallen, M41): Bucht die Bank doch, trifft die
  // End-to-End-ID der Einzelzeile ihren Posten. Eine Sammelgutschrift ohne Einzelzeilen nur gegen eingereichte.
  const runs = db.select().from(financeDirectDebitRuns).where(inArray(financeDirectDebitRuns.status, ['submitted', 'fileCreated'])).orderBy(asc(financeDirectDebitRuns.collectionDate), asc(financeDirectDebitRuns.id)).all();
  if (runs.length === 0) return { byEndToEnd: new Map(), runs: [] };
  const items = db.select().from(financeDirectDebitItems).where(and(inArray(financeDirectDebitItems.runId, runs.map((r) => r.id)), isNull(financeDirectDebitItems.removedAt))).orderBy(asc(financeDirectDebitItems.createdAt), asc(financeDirectDebitItems.endToEndId)).all();
  const taken = takenItemIdsInternal(db);
  const byEndToEnd = new Map<string, { item: FinanceDirectDebitItemRow; run: FinanceDirectDebitRunRow }>();
  const free: DirectDebitData['runs'] = [];
  for (const run of runs) {
    const own = items.filter((i) => i.runId === run.id);
    for (const item of own) if (!taken.has(item.id)) byEndToEnd.set(item.endToEndId, { item, run });
    if (run.status === 'submitted' && own.length > 0 && own.every((i) => !taken.has(i.id))) free.push({ id: run.id, accountId: run.accountId, collectionDate: run.collectionDate, sumCents: own.reduce((sum, i) => sum + i.amountCents, 0), items: own });
  }
  return { byEndToEnd, runs: free };
}

const byOrder = (a: FinanceRawTransactionRow, b: FinanceRawTransactionRow): number =>
  a.bookingDate.localeCompare(b.bookingDate) || a.lineIndex - b.lineIndex || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Die offenen Kontoumsätze: aus nicht verworfenen Auszügen und von keiner
 * Geldzeile gebunden (auch ein Entwurf bindet). Älteste zuerst — die
 * Reihenfolge, in der die Arbeitsliste sie abarbeitet und (0) Buchungszeilen
 * vergibt.
 */
export function openRawTransactionsInternal(db: DbOrTx): FinanceRawTransactionRow[] {
  const rows = db
    .select({ raw: financeRawTransactions })
    .from(financeRawTransactions)
    .innerJoin(financeImportRuns, eq(financeImportRuns.id, financeRawTransactions.runId))
    .where(isNull(financeImportRuns.discardedAt))
    .all()
    .map((r) => r.raw);
  const bound = new Set(
    db.select({ id: financeMoneyLines.rawTransactionId }).from(financeMoneyLines).where(and(isNotNull(financeMoneyLines.rawTransactionId), isNull(financeMoneyLines.rawReleasedAt))).all().map((r) => r.id!),
  );
  return rows.filter((r) => !bound.has(r.id)).sort(byOrder);
}

/** Geldzeilen ohne Kontoumsatz an Buchungen, die weder zurückgenommen sind noch selbst eine Rücknahme. */
function unboundLinesInternal(db: DbOrTx): UnboundLine[] {
  return db
    .select({
      lineId: financeMoneyLines.id, entryId: financeMoneyLines.entryId, accountId: financeMoneyLines.accountId, amountCents: financeMoneyLines.amountCents,
      number: financeEntries.number, entryDate: financeEntries.entryDate, status: financeEntries.status,
    })
    .from(financeMoneyLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .where(and(isNull(financeMoneyLines.rawTransactionId), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId)))
    .all()
    .map((l) => ({ ...l, status: l.status as 'draft' | 'final' }));
}

/** Festes Fenster für Befund 29 — unabhängig von `finance.matchEntryDays` (das bleibt bei 5, max 30). */
const CASH_TRANSFER_LINK_DAYS = 30;

/**
 * Befund 29: Bevor die Bar-Kennung eine **neue** Umbuchung gegen die Kasse
 * vorschlägt, zuerst nach einer bereits vorhandenen, noch unverknüpften
 * Kasse⇄Bank-Umbuchung gleichen Betrags suchen (30 Tage, fest) — sonst
 * entstünde eine doppelte Umbuchung, wenn die Bareinzahlung erst Tage nach
 * dem Wegbringen im Auszug auftaucht. Nur reine Umbuchungen ohne
 * Zuordnungszeilen zählen — eine gewöhnliche Einnahme mit derselben
 * Bar-Kennung im Text bleibt unberührt.
 */
function findUnlinkedCashTransferInternal(db: DbOrTx, raw: FinanceRawTransactionRow, cashAccountId: string): UnboundLine | null {
  const candidates = db
    .select({
      lineId: financeMoneyLines.id, entryId: financeMoneyLines.entryId, accountId: financeMoneyLines.accountId, amountCents: financeMoneyLines.amountCents,
      number: financeEntries.number, entryDate: financeEntries.entryDate, status: financeEntries.status,
    })
    .from(financeMoneyLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .where(and(
      isNull(financeMoneyLines.rawTransactionId), eq(financeMoneyLines.accountId, raw.accountId), eq(financeMoneyLines.amountCents, raw.amountCents),
      isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId),
    ))
    .all();
  if (candidates.length === 0) return null;
  const entryIds = candidates.map((c) => c.entryId);
  const cashLegEntryIds = new Set(
    db.select({ entryId: financeMoneyLines.entryId }).from(financeMoneyLines)
      .where(and(inArray(financeMoneyLines.entryId, entryIds), eq(financeMoneyLines.accountId, cashAccountId), eq(financeMoneyLines.amountCents, -raw.amountCents)))
      .all().map((l) => l.entryId),
  );
  const allocatedEntryIds = new Set(
    db.select({ entryId: financeAllocationLines.entryId }).from(financeAllocationLines).where(inArray(financeAllocationLines.entryId, entryIds)).all().map((l) => l.entryId),
  );
  let best: { line: UnboundLine; days: number } | null = null;
  for (const c of candidates) {
    if (!cashLegEntryIds.has(c.entryId) || allocatedEntryIds.has(c.entryId)) continue;
    const days = daysApart(c.entryDate, raw.bookingDate);
    if (days > CASH_TRANSFER_LINK_DAYS) continue;
    if (!best || days < best.days) best = { line: { ...c, status: c.status as 'draft' | 'final' }, days };
  }
  return best?.line ?? null;
}

/**
 * (0) greift nur, solange die Zeile frei ist, und jede Zeile geht an genau
 * einen Umsatz: der älteste zuerst, jeweils die zeitlich nächste Zeile. Zwei
 * gleiche Lastschriften auf eine Handbuchung — nur die erste bekommt
 * „verknüpfen“ (Review Focus 1).
 */
function claimLinesInternal(openRaws: readonly FinanceRawTransactionRow[], lines: readonly UnboundLine[], matchEntryDays: number): Map<string, UnboundLine> {
  const claims = new Map<string, UnboundLine>();
  const taken = new Set<string>();
  for (const raw of openRaws) {
    let best: { line: UnboundLine; days: number } | null = null;
    for (const line of lines) {
      if (taken.has(line.lineId) || line.accountId !== raw.accountId || line.amountCents !== raw.amountCents) continue;
      const days = daysApart(line.entryDate, raw.bookingDate);
      if (days > matchEntryDays) continue;
      if (!best || days < best.days || (days === best.days && (line.entryDate.localeCompare(best.line.entryDate) || line.lineId.localeCompare(best.line.lineId)) < 0)) best = { line, days };
    }
    if (best) {
      claims.set(raw.id, best.line);
      taken.add(best.line.lineId);
    }
  }
  return claims;
}

/**
 * Offene Zahlungen, die ein **Entwurf** schon begleicht — die sind vergeben.
 * Festgeschriebene Teilzahlungen dagegen stecken schon in `openCentsInternal`;
 * der Rest bleibt vorschlagbar (Nachtrag Lauf 4).
 */
function draftSettledItemIdsInternal(db: DbOrTx): Set<string> {
  return new Set(
    db
      .select({ id: financeOpenItemSettlements.openItemId })
      .from(financeOpenItemSettlements)
      .innerJoin(financeMoneyLines, eq(financeMoneyLines.id, financeOpenItemSettlements.moneyLineId))
      .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
      .where(eq(financeEntries.status, 'draft'))
      .all()
      .map((r) => r.id),
  );
}

function loadSuggestionDataInternal(deps: Deps): SuggestionData {
  const db = deps.db;
  const draftSettled = draftSettledItemIdsInternal(db);
  const settings = {
    matchDays: readSetting<number>(deps, 'finance.pairMatchDays'),
    feeToleranceCents: readSetting<number>(deps, 'finance.pairFeeToleranceCents'),
    matchEntryDays: readSetting<number>(deps, 'finance.matchEntryDays'),
    cashKeywords: readSetting<string[]>(deps, 'finance.cashKeywords'),
  };
  const openRaws = openRawTransactionsInternal(db);
  const categoryRows = db.select().from(financeCategories).all();
  return {
    settings,
    openRaws,
    linkClaims: claimLinesInternal(openRaws, unboundLinesInternal(db), settings.matchEntryDays),
    openItems: db
      .select()
      .from(financeOpenItems)
      .where(isNull(financeOpenItems.cancelledAt))
      .orderBy(asc(financeOpenItems.itemDate), asc(financeOpenItems.id))
      .all()
      // Begleicht ein Entwurf sie schon, ist die Zahlung vergeben; festgeschriebene Raten stecken in openCents.
      .filter((row) => !draftSettled.has(row.id))
      .map((row) => ({ row, openCents: openCentsInternal(db, row.id) }))
      .filter((i) => i.openCents > 0),
    rules: activeImportRulesInternal(db),
    categories: new Map(categoryRows.map((c) => [c.id, c] as const)),
    categoriesByKey: new Map(categoryRows.map((c) => [c.key, c] as const)),
    purposes: new Map(db.select().from(financePurposes).all().map((p) => [p.id, p] as const)),
    cashAccountIds: db.select({ id: financeAccounts.id }).from(financeAccounts).where(and(eq(financeAccounts.kind, 'cash'), eq(financeAccounts.isActive, true))).orderBy(asc(financeAccounts.createdAt), asc(financeAccounts.id)).all().map((a) => a.id),
    // Befund 14: ein Zahlungsdienst (PayPal etc.) hat selbst keine deutsche IBAN — kein Hinweis auf dem eigenen Konto.
    paymentServiceAccountIds: db.select({ id: financeAccounts.id }).from(financeAccounts).where(eq(financeAccounts.kind, 'paymentService')).all().map((a) => a.id),
    directDebit: loadDirectDebitDataInternal(db),
  };
}

/** Buchungstext aus den Bankdaten: Gegenpartei und Verwendungszweck; ohne beides das Buchungsdatum. Auch für den leeren Entwurf beim Beleg (`import/vouchers.ts`). */
export function defaultText(raw: FinanceRawTransactionRow): string {
  const text = [raw.counterpartyName, raw.purpose].map((s) => (s ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean).join(' · ');
  return (text || raw.bookingDate).slice(0, 300);
}

const rawLine = (raw: FinanceRawTransactionRow) => ({ accountId: raw.accountId, amountCents: raw.amountCents, rawTransactionId: raw.id });

type AllocationInput = EntryLinesInput['allocationLines'][number];

/** Eine Zuordnungszeile ohne leere Felder — so bleibt die Vorbelegung lesbar. `abroad` (F7 Task 4) nur, wenn die Vorlage es ausdrücklich setzt — sonst leitet `resolveEntryLines` es wie bisher aus Zweck/Projekt ab. */
function allocation(fields: { categoryId: string; amountCents: number; taxCode?: string | null; projectId?: string | null; purposeId?: string | null; contactId?: string | null; originLineId?: string | null; abroad?: boolean; directDebitItemId?: string | null }): AllocationInput {
  const line: Record<string, unknown> = { categoryId: fields.categoryId, amountCents: fields.amountCents };
  for (const key of ['taxCode', 'projectId', 'purposeId', 'contactId', 'originLineId', 'directDebitItemId'] as const) if (fields[key]) line[key] = fields[key];
  if (fields.abroad !== undefined) line.abroad = fields.abroad;
  return line as AllocationInput;
}

/**
 * Zeilenvorlage einer offenen Zahlung (JSON) → Zuordnungszeilen; eine einzelne
 * Zeile bekommt den Betrag des Umsatzes. Trägt keine Vorlagenzeile eine
 * Kategorie (die offene Zahlung aus einer Rechnung, F5b Annahme 4), belegt die
 * erste Kennzeichen und Kontakt einer Zeile mit **leerer** Kategorie und dem
 * ganzen Betrag vor — die Kategorie wählt der Mensch.
 */
function linesFromTemplate(item: FinanceOpenItemRow, amountCents: number): AllocationInput[] {
  if (!item.lineTemplate) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.lineTemplate);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const objects = parsed.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r));
  const records = objects.filter((r) => typeof r.categoryId === 'string' && r.categoryId !== '');
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  if (records.length === 0) {
    const first = objects[0];
    if (!first) return [];
    return [allocation({ categoryId: '', amountCents, taxCode: str(first.taxCode), contactId: str(first.contactId) ?? item.contactId, abroad: bool(first.abroad) })];
  }
  return records.map((r) =>
    allocation({
      categoryId: r.categoryId as string,
      amountCents: records.length === 1 || typeof r.amountCents !== 'number' ? amountCents : (r.amountCents as number),
      taxCode: str(r.taxCode), projectId: str(r.projectId), purposeId: str(r.purposeId), contactId: str(r.contactId) ?? item.contactId, abroad: bool(r.abroad),
    }),
  );
}

/** Bei (2): gebundene Umsätze mit den Zuordnungen ihrer Buchung — nur geladen, wenn ein Rückgabe-Code da ist. */
function bookedRawsInternal(db: DbOrTx): (FinanceRawTransactionRow & { entryId: string; entryNumber: string | null; entryStatus: string; lines: FinanceAllocationLineRow[] })[] {
  const bound = db
    .select({ raw: financeRawTransactions, entryId: financeEntries.id, entryNumber: financeEntries.number, entryStatus: financeEntries.status })
    .from(financeMoneyLines)
    .innerJoin(financeRawTransactions, eq(financeRawTransactions.id, financeMoneyLines.rawTransactionId))
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .where(and(isNull(financeMoneyLines.rawReleasedAt), isNull(financeEntries.reversedByEntryId)))
    .all();
  if (bound.length === 0) return [];
  const lines = db.select().from(financeAllocationLines).where(inArray(financeAllocationLines.entryId, bound.map((b) => b.entryId))).orderBy(asc(financeAllocationLines.position)).all();
  return bound.map((b) => ({ ...b.raw, entryId: b.entryId, entryNumber: b.entryNumber, entryStatus: b.entryStatus, lines: lines.filter((l) => l.entryId === b.entryId) }));
}

/**
 * Bei (2): Rück-Ausgleiche für die Geldzeile einer Rückgabe (Spec Mitglieder und Lastschrift § 6.2) — je Ausgleich
 * der zurückgegebenen Geldzeile, in der Reihenfolge der Ausgleiche, was davon noch nicht zurückgenommen ist, zusammen
 * höchstens der Rückbetrag. Nur an einer festgeschriebenen Ursprungsbuchung (sonst `[]`).
 */
function reversalSettlementsInternal(db: DbOrTx, origin: { id: string; entryId: string; entryStatus: string }, returnedCents: number, openItemId?: string): NonNullable<EntryLinesInput['moneyLines'][number]['settlements']> {
  if (origin.entryStatus !== 'final') return [];
  const line = db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(and(eq(financeMoneyLines.entryId, origin.entryId), eq(financeMoneyLines.rawTransactionId, origin.id), isNull(financeMoneyLines.rawReleasedAt))).get();
  if (!line) return [];
  // Plan L3: aus einer Sammelbuchung nur der Ausgleich des einen zurückgegebenen Postens (Review Focus 3).
  const given = db.select().from(financeOpenItemSettlements).where(and(eq(financeOpenItemSettlements.moneyLineId, line.id), isNull(financeOpenItemSettlements.reversesSettlementId), openItemId ? eq(financeOpenItemSettlements.openItemId, openItemId) : undefined)).orderBy(asc(financeOpenItemSettlements.id)).all();
  if (given.length === 0) return [];
  const taken = db
    .select({ reversesSettlementId: financeOpenItemSettlements.reversesSettlementId, amountCents: financeOpenItemSettlements.amountCents })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(and(inArray(financeOpenItemSettlements.reversesSettlementId, given.map((g) => g.id)), isNull(financeEntries.reversedByEntryId)))
    .all();
  let rest = returnedCents;
  const out: NonNullable<EntryLinesInput['moneyLines'][number]['settlements']> = [];
  for (const settlement of given) {
    const open = settlement.amountCents - taken.filter((t) => t.reversesSettlementId === settlement.id).reduce((s, t) => s + t.amountCents, 0);
    const amountCents = Math.min(open, rest);
    if (amountCents <= 0) continue;
    out.push({ openItemId: settlement.openItemId, amountCents, reversesSettlementId: settlement.id });
    rest -= amountCents;
    if (rest === 0) break;
  }
  return out;
}

/**
 * AC: Eine ausgehende Zeile mit Bezug auf die Transaktion einer gebuchten
 * Zahlung (PayPal „Zugehöriger Transaktionscode“) ist deren Rückzahlung — als
 * Rückgabe mit `originLineId` auf die Zuordnungszeile der Zahlung, auch bei
 * Teilbetrag. „Sicher“, weil der Bezug eindeutig ist (Bankreferenz je Konto);
 * ist die Zahlung noch Entwurf, wie bei (2) unsicher und ohne `originLineId`.
 * Mehr als die Zahlung ist keine Rückzahlung, und passt der Betrag auf keine
 * eindeutige Zeile, bleibt die Aufteilung dem Menschen.
 */
function refundProposalInternal(db: DbOrTx, raw: FinanceRawTransactionRow, draftOf: (moneyLines: EntryLinesInput['moneyLines'], allocationLines: AllocationInput[]) => SuggestionDraft): Proposal | null {
  const origin = bookedRawsInternal(db).find((b) => b.accountId === raw.accountId && b.bankReference === raw.relatedReference && b.amountCents > 0);
  if (!origin) return null;
  const refunded = -raw.amountCents;
  const given = origin.lines.filter((l) => l.amountCents > 0);
  const givenSum = given.reduce((s, l) => s + l.amountCents, 0);
  if (given.length === 0 || refunded > givenSum) return null;
  const final = origin.entryStatus === 'final';
  const back = (l: FinanceAllocationLineRow, amountCents: number) =>
    allocation({ categoryId: l.categoryId, amountCents, taxCode: l.taxCode, projectId: l.projectId, purposeId: l.purposeId, contactId: l.contactId, originLineId: final ? l.id : null });
  const lines = refunded === givenSum ? given.map((l) => back(l, -l.amountCents)) : given.length === 1 ? [back(given[0]!, raw.amountCents)] : [];
  const reasons: SuggestionReason[] = [{ kind: 'relatedReference', entryId: origin.entryId, entryNumber: origin.entryNumber }];
  const draft = draftOf([rawLine(raw)], lines);
  if (!final) return { kind: 'return', confidence: 'unsure', extraHints: ['originIsDraft'], reasons, draft };
  return { kind: 'return', confidence: lines.length > 0 ? 'sure' : 'unsure', reasons, draft };
}

/** Die Posten eingereichter Einzüge, die eine Rückgabe treffen kann — für Vorschlag (2) und das Entgelt (M37, U3). */
function returnableItemsInternal(db: DbOrTx) {
  return db
    .select({ item: financeDirectDebitItems, run: financeDirectDebitRuns, mandateReference: financeSepaMandates.reference })
    .from(financeDirectDebitItems)
    .innerJoin(financeDirectDebitRuns, eq(financeDirectDebitRuns.id, financeDirectDebitItems.runId))
    .innerJoin(financeSepaMandates, eq(financeSepaMandates.id, financeDirectDebitItems.mandateId))
    .where(and(isNull(financeDirectDebitItems.removedAt), inArray(financeDirectDebitRuns.status, ['submitted', 'booked'])))
    .all()
    .map((r) => ({ id: r.item.id, endToEndId: r.item.endToEndId, mandateReference: r.mandateReference, amountCents: r.item.amountCents, collectionDate: r.run.collectionDate, accountId: r.run.accountId, row: r }));
}

/**
 * Plan L3 (Spec § 7.7): Rücklastschrift eines Postens aus einem Einzug — zuerst über die End-to-End-ID der Posten,
 * sonst über Mandatsreferenz und Betrag. Gefunden ist **der eine Posten**; der Entwurf nimmt nur dessen Zeile der
 * Gutschrift zurück (`originLineId`, bei einem Beitrag mit Rück-Ausgleich seines Postens), das Entgelt der Bank wird
 * eine eigene Gebührenzeile. Ist die Gutschrift erst ein Entwurf, wie bei (2): unsicher, Hinweis, ohne Bezug.
 */
function directDebitReturnProposalInternal(db: DbOrTx, data: SuggestionData, raw: FinanceRawTransactionRow, draftOf: (moneyLines: EntryLinesInput['moneyLines'], allocationLines: AllocationInput[]) => SuggestionDraft): Proposal | null {
  const hit = findReturnedItem(raw, returnableItemsInternal(db), { feeToleranceCents: data.settings.feeToleranceCents });
  if (!hit) return null;
  const { item, run } = hit.row;
  const credit = creditLinesOfItemInternal(db, item.id);
  const origin = credit[0];
  const final = origin?.entryStatus === 'final';
  const feeCents = -raw.amountCents - item.amountCents;
  const debtorName = db.select({ name: financeSepaMandates.debtorName }).from(financeSepaMandates).where(eq(financeSepaMandates.id, item.mandateId)).get()?.name ?? '';
  const reasons: SuggestionReason[] = [
    {
      kind: 'directDebitReturn',
      runId: run.id,
      collectionDate: run.collectionDate,
      returnCode: raw.returnCode,
      matchedBy: raw.endToEndId && raw.endToEndId === item.endToEndId ? 'endToEnd' : 'mandateAndAmount',
      returnedItem: { source: item.source, installmentOn: item.installmentOn, debtorName, amountCents: item.amountCents },
      ...(feeCents > 0 ? { feeCents } : {}),
      ...(origin ? { entryId: origin.line.entryId, entryNumber: origin.entryNumber } : {}),
    },
  ];
  const back = credit.length > 0
    ? credit.map(({ line: l }) => allocation({ categoryId: l.categoryId, amountCents: -l.amountCents, taxCode: l.taxCode, projectId: l.projectId, purposeId: l.purposeId, contactId: l.contactId, originLineId: final ? l.id : null, directDebitItemId: item.id }))
    : directDebitLinesInternal(db, data, [item]).allocationLines.map((l) => ({ ...l, amountCents: -l.amountCents }));
  const fee = feeCents > 0 ? data.categoriesByKey.get(BANK_FEE_CATEGORY_KEY) : undefined;
  if (feeCents > 0) back.push(allocation({ categoryId: fee?.id ?? '', amountCents: -feeCents }));
  const originRaw = final ? db.select({ rawTransactionId: financeMoneyLines.rawTransactionId }).from(financeMoneyLines).where(and(eq(financeMoneyLines.entryId, origin.line.entryId), isNotNull(financeMoneyLines.rawTransactionId), isNull(financeMoneyLines.rawReleasedAt))).get() : undefined;
  const settlements = final && item.source === 'openItem' && originRaw?.rawTransactionId ? reversalSettlementsInternal(db, { id: originRaw.rawTransactionId, entryId: origin.line.entryId, entryStatus: 'final' }, item.amountCents, item.sourceId) : [];
  const draft = draftOf([settlements.length > 0 ? { ...rawLine(raw), settlements } : rawLine(raw)], back);
  const extraProblems: SuggestionView['problems'] = feeCents > 0 && !fee ? ['categoryInactive'] : [];
  if (!final) return { kind: 'return', confidence: 'unsure', extraHints: origin ? ['originIsDraft'] : [], reasons, draft, extraProblems };
  return { kind: 'return', confidence: 'sure', reasons, draft, extraProblems };
}

/**
 * Plan L3 (Spec § 7.6): die Zeilen einer Gutschrift für Posten eines Einzugs — je Posten eine Zuordnung mit
 * `directDebitItemId`. Ein Beitrag gleicht seinen offenen Posten aus (Zeilen aus `lineTemplate`), eine Rate wird eine
 * Spende mit Kontakt, Zweck und Projekt der Zusage — nie ein offener Posten (Anti-Ziel der Spec).
 */
function directDebitLinesInternal(db: DbOrTx, data: SuggestionData, items: readonly FinanceDirectDebitItemRow[]): { settlements: NonNullable<EntryLinesInput['moneyLines'][number]['settlements']>; allocationLines: AllocationInput[]; problems: SuggestionView['problems']; paidOtherwise: NonNullable<SuggestionView['problemParams']['paidOtherwise']>['items'] } {
  const settlements: NonNullable<EntryLinesInput['moneyLines'][number]['settlements']> = [];
  const allocationLines: AllocationInput[] = [];
  const problems: SuggestionView['problems'] = [];
  const paidOtherwise: NonNullable<SuggestionView['problemParams']['paidOtherwise']>['items'] = [];
  for (const item of items) {
    if (item.source === 'openItem') {
      const open = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, item.sourceId)).get();
      if (!open) continue;
      const openCents = openCentsInternal(db, open.id);
      if (openCents > 0) settlements.push({ openItemId: open.id, amountCents: Math.min(item.amountCents, openCents) });
      // U5 (Plan N3): Was der Posten über den offenen Betrag hinaus einzieht, war schon anders bezahlt.
      const twice = item.amountCents - Math.max(openCents, 0);
      if (twice > 0) paidOtherwise.push({ directDebitItemId: item.id, openItemId: open.id, amountCents: twice });
      const lines = linesFromTemplate(open, item.amountCents);
      const own = lines.length > 0 ? lines : [allocation({ categoryId: '', amountCents: item.amountCents, contactId: open.contactId })];
      allocationLines.push(...own.map((l) => ({ ...l, directDebitItemId: item.id })));
    } else {
      const pledge = db.select().from(financePledges).where(eq(financePledges.id, item.sourceId)).get();
      const donations = data.categoriesByKey.get(DONATION_CATEGORY_KEY);
      if (!donations) problems.push('categoryInactive');
      allocationLines.push(allocation({ categoryId: donations?.id ?? '', amountCents: item.amountCents, contactId: pledge?.contactId, purposeId: pledge?.purposeId, projectId: pledge?.projectId, directDebitItemId: item.id }));
    }
  }
  return { settlements, allocationLines, problems, paidOtherwise };
}

/**
 * M37 (Spec § 7.7): Schickt die Bank das Entgelt einer Rücklastschrift als eigene Buchung („Entgelt Rücklastschrift“)
 * am Tag einer Rückgabe auf demselben Konto, wird es die Gebühr dieser Rückgabe (Kategorie Bankentgelte), unsicher.
 * U3 (Plan N3): Der Grund nennt den Tag des Einzugs, aus dem die Rückgaben dieses Tages stammen — nur, wenn es genau
 * einer ist. Festgeschrieben zählt das Entgelt zur Rückgabe, wenn es an dem Tag genau eine gibt
 * (`separateReturnFeeCentsInternal`).
 */
function returnFeeProposalInternal(db: DbOrTx, data: SuggestionData, raw: FinanceRawTransactionRow, draftOf: (moneyLines: EntryLinesInput['moneyLines'], allocationLines: AllocationInput[]) => SuggestionDraft): Proposal | null {
  if (!isReturnFeeLine(raw)) return null;
  const sameDay = db.select().from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, raw.accountId), eq(financeRawTransactions.bookingDate, raw.bookingDate), isNotNull(financeRawTransactions.returnCode))).all();
  if (sameDay.length === 0) return null;
  const items = returnableItemsInternal(db);
  const days = new Set(sameDay.map((r) => findReturnedItem(r, items, { feeToleranceCents: data.settings.feeToleranceCents })?.collectionDate).filter((d): d is string => !!d));
  const fee = data.categoriesByKey.get(BANK_FEE_CATEGORY_KEY);
  const reason: SuggestionReason = days.size === 1 ? { kind: 'directDebitReturnFee', collectionDate: [...days][0]! } : { kind: 'directDebitReturnFee' };
  return { kind: 'fee', confidence: 'unsure', reasons: [reason], draft: draftOf([rawLine(raw)], [allocation({ categoryId: fee?.id ?? '', amountCents: raw.amountCents })]) };
}

/**
 * Der Buchungstext einer Gutschrift (M19): „Lastschrifteinzug 21.10.2026 (2 Posten)“ — Nutzdaten der Buchung, deutsch
 * wie die übrigen Texte, die das Modul in Buchungen schreibt.
 */
export function directDebitCreditText(collectionDate: string, count: number): string {
  return `Lastschrifteinzug ${paperDate(isoDay(collectionDate))} (${count} Posten)`;
}

/**
 * Plan L3 (Spec § 7.6): Gutschrift eines eingereichten Einzugs. (a) Eine Einzelzeile trifft über ihre End-to-End-ID
 * genau einen Posten — sicher, je Zeile ein Vorschlag, nichts künstlich zusammengefasst. (b) Eine Sammelgutschrift
 * ohne Einzelzeilen trifft die Summe eines Einzugs: sicher bei voller Summe und eindeutigem Einzug; zieht die Bank
 * Entgelte ab, kommt eine Gebührenzeile dazu, und der Vorschlag ist unsicher; passen mehrere, nur die Rückfrage.
 */
function directDebitProposalInternal(db: DbOrTx, data: SuggestionData, raw: FinanceRawTransactionRow, draftOf: (moneyLines: EntryLinesInput['moneyLines'], allocationLines: AllocationInput[], text?: string) => SuggestionDraft): Proposal | null {
  if (raw.amountCents <= 0) return null;
  const reason = (run: { id: string; collectionDate: string }, matchedBy: 'endToEnd' | 'sum', itemCount: number, feeCents = 0): SuggestionReason => ({ kind: 'directDebitRun', runId: run.id, collectionDate: run.collectionDate, matchedBy, itemCount, ...(feeCents > 0 ? { feeCents } : {}) });
  const build = (run: { collectionDate: string }, items: readonly FinanceDirectDebitItemRow[], feeCents: number) => {
    const lines = directDebitLinesInternal(db, data, items);
    const fee = feeCents > 0 ? data.categoriesByKey.get(BANK_FEE_CATEGORY_KEY) : undefined;
    if (feeCents > 0) lines.allocationLines.push(allocation({ categoryId: fee?.id ?? '', amountCents: -feeCents }));
    const problems: SuggestionView['problems'] = feeCents > 0 && !fee ? [...lines.problems, 'categoryInactive' as const] : [...lines.problems];
    const problemParams: SuggestionView['problemParams'] = {};
    if (lines.paidOtherwise.length > 0) {
      problems.push('paidOtherwise');
      problemParams.paidOtherwise = { count: lines.paidOtherwise.length, amountCents: lines.paidOtherwise.reduce((sum, i) => sum + i.amountCents, 0), items: lines.paidOtherwise };
    }
    return { draft: draftOf([lines.settlements.length > 0 ? { ...rawLine(raw), settlements: lines.settlements } : rawLine(raw)], lines.allocationLines, directDebitCreditText(run.collectionDate, items.length)), extraProblems: problems, problemParams };
  };
  // Ein anders bezahlter Posten braucht den Menschen: nie „sicher“ (wie `settleProposal`).
  const confident = (confidence: SuggestionView['confidence'], built: { problemParams: SuggestionView['problemParams'] }): SuggestionView['confidence'] => (built.problemParams.paidOtherwise && confidence === 'sure' ? 'unsure' : confidence);
  if (raw.endToEndId) {
    const hit = data.directDebit.byEndToEnd.get(raw.endToEndId);
    if (!hit || hit.run.accountId !== raw.accountId || hit.item.amountCents !== raw.amountCents) return null;
    const built = build(hit.run, [hit.item], 0);
    return { kind: 'directDebitRun', confidence: confident('sure', built), reasons: [reason(hit.run, 'endToEnd', 1)], ...built };
  }
  const { exact, short } = findRunsForCredit(raw, data.directDebit.runs, { feeToleranceCents: data.settings.feeToleranceCents });
  const fitting = exact.length > 0 ? exact : short;
  if (fitting.length === 0) return null;
  if (fitting.length > 1) {
    return { kind: 'directDebitRun', confidence: 'possible', draft: null, reasons: [{ kind: 'directDebitRun', runCandidates: fitting.map((r) => ({ runId: r.id, collectionDate: r.collectionDate, sumCents: r.sumCents })) }] };
  }
  const run = fitting[0]!;
  const feeCents = run.sumCents - raw.amountCents;
  const built = build(run, run.items, feeCents);
  return { kind: 'directDebitRun', confidence: confident(feeCents === 0 ? 'sure' : 'unsure', built), reasons: [reason(run, 'sum', run.items.length, feeCents)], ...built };
}

const normalizeName = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * AB: der Kontakt eines Umsatzes ohne IBAN — über die E-Mail der Gegenseite
 * (genau, ohne Groß/Klein; ein Treffer auf genau einen aktiven Kontakt) oder
 * über den Namen (Anzeigename gleich bis auf Leerraum und Groß/Klein, genau
 * ein aktiver Kontakt). Mehrdeutig heißt: kein Vorschlag, nie geraten.
 */
function contactForPartyInternal(db: DbOrTx, raw: FinanceRawTransactionRow): { contactId: string; kind: 'contactEmail' | 'contactName' } | null {
  const email = raw.counterpartyEmail?.trim().toLowerCase();
  if (email) {
    const ids = new Set(
      db.select({ contactId: contactChannels.contactId, value: contactChannels.value }).from(contactChannels)
        .innerJoin(contacts, eq(contacts.id, contactChannels.contactId))
        .where(and(eq(contactChannels.kind, 'email'), eq(contacts.status, 'active'))).all()
        .filter((c) => c.value.trim().toLowerCase() === email).map((c) => c.contactId),
    );
    if (ids.size === 1) return { contactId: [...ids][0]!, kind: 'contactEmail' };
  }
  const name = raw.counterpartyName ? normalizeName(raw.counterpartyName) : '';
  if (!name) return null;
  const hits = db.select().from(contacts).where(eq(contacts.status, 'active')).all().filter((c) => normalizeName(displayName(c)) === name);
  return hits.length === 1 ? { contactId: hits[0]!.id, kind: 'contactName' } : null;
}

/** Die aktiven Kontakte, deren Zuordnung die IBAN trägt — wie `contactForIbanInternal`, aber alle statt nur eines eindeutigen. */
function activeIbanHoldersInternal(db: DbOrTx, iban: string): string[] {
  const all = contactsForIbanInternal(db, iban);
  if (all.length < 2) return all;
  const active = new Set(db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.id, all), eq(contacts.status, 'active'))).all().map((c) => c.id));
  return all.filter((id) => active.has(id));
}

function problemsOf(data: SuggestionData, draft: SuggestionDraft | null, extra: SuggestionView['problems'] = []): SuggestionView['problems'] {
  const problems = new Set(extra);
  for (const line of draft?.allocationLines ?? []) {
    // Eine leere Kategorie (Zeilenvorlage ohne Kategorie) wählt der Mensch — kein Problem.
    if (line.categoryId !== '' && !data.categories.get(line.categoryId)?.isActive) problems.add('categoryInactive');
    const purpose = line.purposeId ? data.purposes.get(line.purposeId) : undefined;
    if (purpose && (!purpose.isActive || purpose.fulfilledAt !== null || purpose.dissolvedAt !== null)) problems.add('purposeClosed');
  }
  return [...problems];
}

type Proposal = Pick<SuggestionView, 'kind' | 'confidence' | 'reasons' | 'draft'> & { linkEntry?: SuggestionView['linkEntry']; extraProblems?: SuggestionView['problems']; extraHints?: SuggestionView['hints']; problemParams?: SuggestionView['problemParams'] };

/** Die Vorschläge, bei denen ein Kontakt eine Rolle spielt: Dort nennt der Grund die Inhaber eines Gemeinschaftskontos. */
const CONTACT_KINDS: ReadonlySet<SuggestionKind> = new Set(['openItem', 'rule', 'contact', 'none']);

/**
 * Gemeinschaftskonto (Plan U4 Task 3, Joe 2026-10-19): Tragen mehrere aktive Kontakte die IBAN, nennt der Vorschlag
 * beide (`sharedIban`) — „IBAN gehört zu X und Y“. Der Kontakt bleibt eine Wahl, außer genau einer hat einen passenden
 * offenen Posten (dann bleibt die Vorbelegung aus 968500b9).
 */
function proposeInternal(deps: Deps, data: SuggestionData, raw: FinanceRawTransactionRow): Proposal {
  const proposal = proposeBaseInternal(deps, data, raw);
  if (!raw.counterpartyIban || !CONTACT_KINDS.has(proposal.kind)) return proposal;
  const holders = activeIbanHoldersInternal(deps.db, raw.counterpartyIban);
  return holders.length > 1 ? { ...proposal, reasons: [...proposal.reasons, { kind: 'sharedIban', contactIds: holders }] } : proposal;
}

function proposeBaseInternal(deps: Deps, data: SuggestionData, raw: FinanceRawTransactionRow): Proposal {
  const draftOf = (moneyLines: EntryLinesInput['moneyLines'], allocationLines: AllocationInput[], text = defaultText(raw)): SuggestionDraft => ({ entryDate: raw.bookingDate, text, moneyLines, allocationLines });

  // (0) Passt zu einer vorhandenen Buchung.
  const claim = data.linkClaims.get(raw.id);
  if (claim) {
    return {
      kind: 'linkEntry', confidence: 'sure', draft: null,
      reasons: [{ kind: 'linkEntry', entryId: claim.entryId, entryNumber: claim.number }],
      linkEntry: { entryId: claim.entryId, number: claim.number, entryDate: claim.entryDate, status: claim.status },
    };
  }

  // (1) Umbuchung zwischen eigenen Konten — mit Gebührenzeile, wenn unterwegs etwas fehlt.
  const pair = findPair(raw, data.openRaws, { matchDays: data.settings.matchDays, feeToleranceCents: data.settings.feeToleranceCents });
  if (pair) {
    const fee = data.categoriesByKey.get(FEE_CATEGORY_KEY);
    const allocationLines = pair.feeCents > 0 && fee ? [allocation({ categoryId: fee.id, amountCents: -pair.feeCents })] : [];
    return {
      kind: 'transfer', confidence: 'sure',
      reasons: [{ kind: 'pair', otherAccountId: pair.other.accountId, otherRawTransactionId: pair.other.id }],
      draft: draftOf([rawLine(raw), rawLine(pair.other)], allocationLines),
      extraProblems: pair.feeCents > 0 && !fee ? ['categoryInactive'] : [],
    };
  }
  // (1) Bar-Kennung: zuerst eine vorhandene, noch unverknüpfte Umbuchung suchen (Befund 29), sonst neu vorschlagen.
  const cashAccountId = data.cashAccountIds.find((id) => id !== raw.accountId);
  if (cashAccountId && isCashKeyword(raw.purpose, data.settings.cashKeywords)) {
    const existing = findUnlinkedCashTransferInternal(deps.db, raw, cashAccountId);
    if (existing) {
      return {
        kind: 'linkEntry', confidence: 'sure', draft: null,
        reasons: [{ kind: 'cashTransferEntry', entryId: existing.entryId, entryNumber: existing.number }],
        linkEntry: { entryId: existing.entryId, number: existing.number, entryDate: existing.entryDate, status: existing.status },
      };
    }
    return {
      kind: 'cashTransfer', confidence: 'sure',
      reasons: [{ kind: 'cashKeyword', otherAccountId: cashAccountId }],
      draft: draftOf([rawLine(raw), { accountId: cashAccountId, amountCents: -raw.amountCents }], []),
    };
  }

  // (2) Zurückgegebene Zahlung: die Zuordnungen der ursprünglichen Buchung, negiert und mit `originLineId`.
  if (raw.returnCode) {
    // Plan L3: zuerst der Posten eines Einzugs — eine Sammelgutschrift hat keinen Umsatz je Posten.
    const directDebitReturn = directDebitReturnProposalInternal(deps.db, data, raw, draftOf);
    if (directDebitReturn) return directDebitReturn;
    const booked = bookedRawsInternal(deps.db);
    // Ein Entwurf kann seine Zeilen noch ersetzen — an ihn wird keine `originLineId` gebunden (Befund 37).
    // Glich die Zahlung offene Posten aus, nimmt die Rückgabe das mit Rück-Ausgleichen zurück (Spec Mitglieder und Lastschrift § 6.2).
    const originDraft = (origin: (typeof booked)[number]) => {
      const settlements = reversalSettlementsInternal(deps.db, origin, -raw.amountCents);
      return draftOf([settlements.length > 0 ? { ...rawLine(raw), settlements } : rawLine(raw)], origin.lines.map((l) => allocation({ categoryId: l.categoryId, amountCents: -l.amountCents, taxCode: l.taxCode, projectId: l.projectId, purposeId: l.purposeId, contactId: l.contactId, originLineId: origin.entryStatus === 'final' ? l.id : null })));
    };
    const origin = findReturnOrigin(raw, booked);
    const originSum = origin?.lines.reduce((s, l) => s + l.amountCents, 0);
    // Befund 37: Ursprung noch Entwurf — trotzdem ein Vorschlag, unsicher und mit Hinweis; passen seine Zuordnungen nicht, bleibt die Aufteilung dem Menschen.
    if (origin && origin.entryStatus !== 'final') {
      const complete = origin.lines.length > 0 && originSum === -raw.amountCents;
      return {
        kind: 'return', confidence: 'unsure', extraHints: ['originIsDraft'],
        reasons: [{ kind: 'returnCode', entryId: origin.entryId, entryNumber: origin.entryNumber }],
        draft: complete ? originDraft(origin) : draftOf([rawLine(raw)], []),
      };
    }
    if (origin && origin.lines.length > 0 && originSum === -raw.amountCents) {
      return {
        kind: 'return', confidence: 'sure',
        reasons: [{ kind: 'returnCode', entryId: origin.entryId, entryNumber: origin.entryNumber }],
        draft: originDraft(origin),
      };
    }
    // Befund 30a: keine Gegen-IBAN am Umsatz — über Rückgabe-Code, negierten Betrag und Namen (60 Tage), nie „sicher“.
    if (!raw.counterpartyIban) {
      const byName = findReturnOriginsByName(raw, booked).filter((o) => o.lines.length > 0 && o.lines.reduce((s, l) => s + l.amountCents, 0) === -raw.amountCents);
      if (byName.length === 1) {
        const only = byName[0]!;
        return { kind: 'return', confidence: 'possible', reasons: [{ kind: 'returnCode', entryId: only.entryId, entryNumber: only.entryNumber }], draft: originDraft(only) };
      }
      if (byName.length > 1) {
        return {
          kind: 'return', confidence: 'possible', draft: null,
          reasons: [{ kind: 'returnCode', returnCandidates: byName.map((o) => ({ entryId: o.entryId, entryNumber: o.entryNumber })) }],
        };
      }
    }
  }

  // (2) AC: Rückzahlung über einen Zahlungsdienst — der Umsatz nennt die Transaktion der Zahlung, die er (auch teilweise) zurückgibt.
  if (raw.amountCents < 0 && raw.relatedReference) {
    const refund = refundProposalInternal(deps.db, raw, draftOf);
    if (refund) return refund;
  }

  // AB: die Gebührenzeile eines Zahlungsdienstes (Kennung `…:fee` aus dem Import) — Kategorie über ihre Kennung, nie über den Namen.
  if (raw.bankReference?.endsWith(':fee')) {
    const fee = data.categoriesByKey.get(FEE_CATEGORY_KEY);
    if (fee) return { kind: 'fee', confidence: 'sure', reasons: [{ kind: 'paymentFee' }], draft: draftOf([rawLine(raw)], [allocation({ categoryId: fee.id, amountCents: raw.amountCents })]) };
  }

  // M37: Das Entgelt einer Rücklastschrift als eigene Zeile am Tag einer Rückgabe — Gebühr zur Rückgabe, unsicher.
  const returnFee = returnFeeProposalInternal(deps.db, data, raw, draftOf);
  if (returnFee) return returnFee;

  // Plan L3: Gutschrift eines eingereichten Einzugs — vor der offenen Zahlung, weil sie mehrere Posten auf einmal trägt.
  const directDebit = directDebitProposalInternal(deps.db, data, raw, draftOf);
  if (directDebit) return directDebit;

  // AB: ohne IBAN ein Eingang über die E-Mail (genau, sicher) oder den Namen (eindeutig, unsicher) — nur, was der Import liefert.
  const byIban = raw.counterpartyIban ? (contactForIbanInternal(deps.db, raw.counterpartyIban)?.contactId ?? null) : null;
  const byParty = !byIban && !raw.counterpartyIban && raw.amountCents > 0 ? contactForPartyInternal(deps.db, raw) : null;
  const contactId = byIban ?? byParty?.contactId ?? null;

  // (3) Offene Zahlung: über die Zahlungsreferenz sicher, über Betrag und Kontakt unsicher.
  const kind = raw.amountCents > 0 ? 'receivable' : 'payable';
  const candidates = data.openItems.filter((i) => i.row.kind === kind);
  const settle = (item: OpenItemLike) => {
    // E4 (M16): Ausgeglichen wird höchstens der offene Betrag; ein Rest wird eine eigene Zeile ohne Kategorie — der
    // Mensch wählt Spende, Rückzahlung o. Ä., nie still die Kategorie des Postens.
    const settled = Math.min(Math.abs(raw.amountCents), item.openCents);
    const sign = Math.sign(raw.amountCents);
    const rest = Math.abs(raw.amountCents) - settled;
    const lines = linesFromTemplate(item.row, sign * settled);
    if (rest > 0) lines.push(allocation({ categoryId: '', amountCents: sign * rest, contactId: item.row.contactId }));
    return draftOf([{ ...rawLine(raw), settlements: [{ openItemId: item.row.id, amountCents: settled }] }], lines);
  };
  /** Was ein Ausgleich des Postens verbergen würde (Plan N1 Task 2): eingereichter Einzug (M17), Überzahlung (E4). */
  const settleProposal = (item: OpenItemLike, proposal: Omit<Proposal, 'draft'>): Proposal => {
    const problems: SuggestionView['problems'] = [];
    const problemParams: SuggestionView['problemParams'] = {};
    const submitted = unreturnedRunItemsInternal(deps.db, { source: 'openItem', sourceId: item.row.id }).find((r) => r.status === 'submitted');
    if (submitted) {
      problems.push('inSubmittedRun');
      problemParams.inSubmittedRun = { date: submitted.collectionDate };
    }
    const rest = Math.abs(raw.amountCents) - item.openCents;
    if (rest > 0) {
      problems.push('overpaid');
      problemParams.overpaid = { amountCents: rest };
    }
    // Beides braucht den Menschen: nie „sicher“ (sonst stünde es unter den Vorschlägen zum schnellen Übernehmen).
    return { ...proposal, confidence: problems.length > 0 && proposal.confidence === 'sure' ? 'unsure' : proposal.confidence, draft: settle(item), extraProblems: problems, problemParams };
  };
  const byReferenceIds = findByReference(raw.purpose, candidates.map((i) => ({ id: i.row.id, paymentReference: i.row.paymentReference })));
  // Befund Z: zwei Posten mit derselben Referenz — dieselbe Rechnung zweimal erfasst? Nie „sicher“ den ersten, beide nennen.
  if (byReferenceIds.length > 1) {
    const ambiguous = byReferenceIds.map((id) => candidates.find((i) => i.row.id === id)!);
    return {
      kind: 'openItem', confidence: 'possible', draft: null,
      reasons: [{ kind: 'paymentReference', paymentReference: ambiguous[0]!.row.paymentReference, openItemCandidates: ambiguous.map((i) => ({ openItemId: i.row.id, itemDate: i.row.itemDate, openCents: i.openCents })) }],
    };
  }
  const byReference = byReferenceIds.length === 1 ? candidates.find((i) => i.row.id === byReferenceIds[0])! : null;
  if (byReference) {
    return settleProposal(byReference, { kind: 'openItem', confidence: 'sure', reasons: [{ kind: 'paymentReference', openItemId: byReference.row.id, paymentReference: byReference.row.paymentReference }] });
  }
  const byAmount = contactId ? candidates.find((i) => i.row.contactId === contactId && i.openCents === Math.abs(raw.amountCents)) : undefined;
  if (byAmount) {
    return settleProposal(byAmount, { kind: 'openItem', confidence: 'unsure', reasons: [{ kind: 'amountAndContact', openItemId: byAmount.row.id, contactId: contactId! }] });
  }
  // Gemeinschaftskonto (2026-10-18): Die IBAN tragen mehrere aktive Kontakte — hat genau einer davon eine offene
  // Zahlung über genau diesen Betrag, wird sie vorgeschlagen, unsicher wie oben; bei keinem oder mehreren bleibt es offen.
  if (!contactId && raw.counterpartyIban) {
    const holders = activeIbanHoldersInternal(deps.db, raw.counterpartyIban);
    const fitting = holders.length > 1 ? candidates.filter((i) => i.row.contactId !== null && holders.includes(i.row.contactId) && i.openCents === Math.abs(raw.amountCents)) : [];
    if (fitting.length === 1) {
      const only = fitting[0]!;
      return settleProposal(only, { kind: 'openItem', confidence: 'unsure', reasons: [{ kind: 'amountAndContact', openItemId: only.row.id, contactId: only.row.contactId! }] });
    }
  }

  // (4) Die erste treffende aktive Regel in ihrer Reihenfolge; ohne Kontakt in der Regel ergänzt ihn die IBAN.
  const rule = data.rules.find((r) => ruleMatches(r, raw));
  if (rule) {
    const lineContact = rule.contactId ?? contactId;
    const reasons: SuggestionReason[] = [{ kind: 'rule', ruleId: rule.id, ruleName: rule.name }];
    if (!rule.contactId && contactId) reasons.push({ kind: byParty?.kind ?? 'contactIban', contactId });
    return {
      kind: 'rule', confidence: 'sure', reasons,
      draft: draftOf([rawLine(raw)], [allocation({ categoryId: rule.categoryId, amountCents: raw.amountCents, taxCode: rule.taxCode, projectId: rule.projectId, purposeId: rule.purposeId, contactId: lineContact })], rule.entryText ?? defaultText(raw)),
    };
  }

  // (5) Nur der Kontakt ist bekannt — unsicher; bei Eingang mit der Vorgabe-Kategorie.
  if (contactId) {
    const income = raw.amountCents > 0 ? data.categoriesByKey.get(CONTACT_INCOME_CATEGORY_KEY) : undefined;
    return {
      kind: 'contact', confidence: byParty?.kind === 'contactEmail' ? 'sure' : 'unsure', reasons: [{ kind: byParty?.kind ?? 'contactIban', contactId }],
      draft: draftOf([rawLine(raw)], income ? [allocation({ categoryId: income.id, amountCents: raw.amountCents, contactId })] : []),
    };
  }

  return { kind: 'none', confidence: 'unsure', reasons: [], draft: null };
}

/**
 * Befund 14: kein Hinweis, wenn das eigene Konto selbst ein Zahlungsdienst
 * ist (der sitzt ohnehin nicht in Deutschland) oder die Gegen-IBAN einem
 * Kontakt gehört (dann ist sie schon eingeordnet, nicht bloß fremd) — auch
 * einem archivierten oder mehreren (Gemeinschaftskonto).
 */
function suppressForeignIbanHint(deps: Deps, data: SuggestionData, raw: FinanceRawTransactionRow): boolean {
  if (data.paymentServiceAccountIds.includes(raw.accountId)) return true;
  return raw.counterpartyIban !== null && contactsForIbanInternal(deps.db, raw.counterpartyIban).length > 0;
}

function suggestInternal(deps: Deps, data: SuggestionData, raw: FinanceRawTransactionRow): SuggestionView {
  const p = proposeInternal(deps, data, raw);
  const hint = suppressForeignIbanHint(deps, data, raw) ? null : paymentServiceHint(raw.counterpartyIban);
  return {
    rawTransactionId: raw.id,
    kind: p.kind,
    confidence: p.confidence,
    reasons: p.reasons,
    draft: p.draft,
    linkEntry: p.linkEntry ?? null,
    problems: problemsOf(data, p.draft, p.extraProblems),
    problemParams: p.problemParams ?? {},
    hints: [...(hint ? [hint] : []), ...(p.extraHints ?? [])],
  };
}

/** Für die Arbeitsliste: die offenen Kontoumsätze (älteste zuerst) mit ihrem Vorschlag — alles mit einem Satz Daten. */
export function openSuggestionsInternal(deps: Deps): { raw: FinanceRawTransactionRow; suggestion: SuggestionView }[] {
  const data = loadSuggestionDataInternal(deps);
  return data.openRaws.map((raw) => ({ raw, suggestion: suggestInternal(deps, data, raw) }));
}

/** Der Vorschlag für einen einzelnen Kontoumsatz, ohne Rechteprüfung — für `attachVoucherToTransaction`, das nur `finance.entriesWrite` verlangt. */
export function suggestionForRawInternal(deps: Deps, raw: FinanceRawTransactionRow): SuggestionView {
  return suggestInternal(deps, loadSuggestionDataInternal(deps), raw);
}

const suggestSchema = z.object({ rawTransactionId: z.string().min(1) });

/**
 * `finance.read`: Bankdaten und Kontakte. Ein inzwischen gebundener Umsatz hat
 * keinen Vorschlag mehr (`suggestionStale`), einer aus einem verworfenen
 * Auszug auch nicht (`rawTransactionDiscarded`).
 */
export async function suggestForTransaction(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<SuggestionView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, suggestSchema, input);
  if (!parsed.ok) return parsed;
  const raw = deps.db.select().from(financeRawTransactions).where(eq(financeRawTransactions.id, parsed.value.rawTransactionId)).get();
  if (!raw) return notFound('financeRawTransaction', parsed.value.rawTransactionId);
  const run = deps.db.select({ discardedAt: financeImportRuns.discardedAt }).from(financeImportRuns).where(eq(financeImportRuns.id, raw.runId)).get();
  if (run?.discardedAt) return financeConflict('rawTransactionDiscarded');
  const bound = deps.db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(and(eq(financeMoneyLines.rawTransactionId, raw.id), isNull(financeMoneyLines.rawReleasedAt))).get();
  if (bound) return financeConflict('suggestionStale');
  return ok(suggestInternal(deps, loadSuggestionDataInternal(deps), raw));
}
