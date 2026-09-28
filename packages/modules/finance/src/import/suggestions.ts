import { notFound, ok, readSetting, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import type { EntryLinesInput } from '../ledger/entries';
import { openCentsInternal } from '../ledger/open-items';
import {
  financeAccounts, financeAllocationLines, financeCategories, financeEntries, financeImportRuns, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, financePurposes, financeRawTransactions,
  type FinanceAllocationLineRow, type FinanceCategoryRow, type FinanceImportRuleRow, type FinanceOpenItemRow, type FinancePurposeRow, type FinanceRawTransactionRow,
} from '../schema';
import { contactChannels, contacts, displayName } from '@kompass/module-contacts';
import { contactForIbanInternal } from './contact-ibans';
import { activeImportRulesInternal } from './rules';
import { daysApart, findPair, isCashKeyword } from './suggest/pair';
import { findByReference } from './suggest/reference';
import { findReturnOrigin, findReturnOriginsByName } from './suggest/return';
import { ruleMatches } from '../rules-pure';
import { paymentServiceHint } from './suggest/text';

/**
 * Vorschläge der Arbeitsliste (F5, Spec 6.4): Jeder offene Kontoumsatz bekommt
 * genau einen Vorschlag, und jeder Vorschlag nennt seine Herkunft. Die
 * Reihenfolge ist fest — (0) passt zu einer vorhandenen Buchung, (1) Umbuchung
 * zwischen eigenen Konten oder gegen die Barkasse, (2) zurückgegebene Zahlung,
 * (3) offene Zahlung, (4) Regel, (5) Kontakt über die IBAN —, die erste, die
 * greift, gewinnt. Die Regeln selbst sind rein (`suggest/`); hier werden sie
 * mit Daten gefüttert. Der Dienst liest nur.
 */
export type SuggestionKind = 'linkEntry' | 'transfer' | 'cashTransfer' | 'return' | 'fee' | 'openItem' | 'rule' | 'contact' | 'none';

export interface SuggestionReason {
  kind: 'linkEntry' | 'cashTransferEntry' | 'pair' | 'cashKeyword' | 'returnCode' | 'relatedReference' | 'paymentFee' | 'paymentReference' | 'amountAndContact' | 'rule' | 'contactIban' | 'contactEmail' | 'contactName';
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
  problems: ('categoryInactive' | 'purposeClosed')[];
  /** `originIsDraft` (Befund 37): die zurückgegebene Zahlung ist noch nicht festgeschrieben. */
  hints: ('foreignIban' | 'originIsDraft')[];
}

/** Die Kategorie einer Gebührenzeile beim Paar (Startplan). */
const FEE_CATEGORY_KEY = 'payment-fees';
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
function allocation(fields: { categoryId: string; amountCents: number; taxCode?: string | null; projectId?: string | null; purposeId?: string | null; contactId?: string | null; originLineId?: string | null; abroad?: boolean }): AllocationInput {
  const line: Record<string, unknown> = { categoryId: fields.categoryId, amountCents: fields.amountCents };
  for (const key of ['taxCode', 'projectId', 'purposeId', 'contactId', 'originLineId'] as const) if (fields[key]) line[key] = fields[key];
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

type Proposal = Pick<SuggestionView, 'kind' | 'confidence' | 'reasons' | 'draft'> & { linkEntry?: SuggestionView['linkEntry']; extraProblems?: SuggestionView['problems']; extraHints?: SuggestionView['hints'] };

function proposeInternal(deps: Deps, data: SuggestionData, raw: FinanceRawTransactionRow): Proposal {
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
    const booked = bookedRawsInternal(deps.db);
    // Ein Entwurf kann seine Zeilen noch ersetzen — an ihn wird keine `originLineId` gebunden (Befund 37).
    const originDraft = (origin: (typeof booked)[number]) =>
      draftOf([rawLine(raw)], origin.lines.map((l) => allocation({ categoryId: l.categoryId, amountCents: -l.amountCents, taxCode: l.taxCode, projectId: l.projectId, purposeId: l.purposeId, contactId: l.contactId, originLineId: origin.entryStatus === 'final' ? l.id : null })));
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

  // AB: ohne IBAN ein Eingang über die E-Mail (genau, sicher) oder den Namen (eindeutig, unsicher) — nur, was der Import liefert.
  const byIban = raw.counterpartyIban ? (contactForIbanInternal(deps.db, raw.counterpartyIban)?.contactId ?? null) : null;
  const byParty = !byIban && !raw.counterpartyIban && raw.amountCents > 0 ? contactForPartyInternal(deps.db, raw) : null;
  const contactId = byIban ?? byParty?.contactId ?? null;

  // (3) Offene Zahlung: über die Zahlungsreferenz sicher, über Betrag und Kontakt unsicher.
  const kind = raw.amountCents > 0 ? 'receivable' : 'payable';
  const candidates = data.openItems.filter((i) => i.row.kind === kind);
  const settle = (item: OpenItemLike) => draftOf([{ ...rawLine(raw), settlements: [{ openItemId: item.row.id, amountCents: Math.min(Math.abs(raw.amountCents), item.openCents) }] }], linesFromTemplate(item.row, raw.amountCents));
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
    return { kind: 'openItem', confidence: 'sure', reasons: [{ kind: 'paymentReference', openItemId: byReference.row.id, paymentReference: byReference.row.paymentReference }], draft: settle(byReference) };
  }
  const byAmount = contactId ? candidates.find((i) => i.row.contactId === contactId && i.openCents === Math.abs(raw.amountCents)) : undefined;
  if (byAmount) {
    return { kind: 'openItem', confidence: 'unsure', reasons: [{ kind: 'amountAndContact', openItemId: byAmount.row.id, contactId: contactId! }], draft: settle(byAmount) };
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
 * Kontakt gehört (dann ist sie schon eingeordnet, nicht bloß fremd).
 */
function suppressForeignIbanHint(deps: Deps, data: SuggestionData, raw: FinanceRawTransactionRow): boolean {
  if (data.paymentServiceAccountIds.includes(raw.accountId)) return true;
  return raw.counterpartyIban !== null && contactForIbanInternal(deps.db, raw.counterpartyIban) !== null;
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
