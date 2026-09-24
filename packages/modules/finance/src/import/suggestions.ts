import { notFound, ok, readSetting, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import type { EntryLinesInput } from '../ledger/entries';
import { openCentsInternal, openItemHasAnySettlementInternal } from '../ledger/open-items';
import {
  financeAccounts, financeAllocationLines, financeCategories, financeEntries, financeImportRuns, financeMoneyLines, financeOpenItems, financePurposes, financeRawTransactions,
  type FinanceAllocationLineRow, type FinanceCategoryRow, type FinanceImportRuleRow, type FinanceOpenItemRow, type FinancePurposeRow, type FinanceRawTransactionRow,
} from '../schema';
import { contactForIbanInternal } from './contact-ibans';
import { activeImportRulesInternal } from './rules';
import { daysApart, findPair, isCashKeyword } from './suggest/pair';
import { findByReference } from './suggest/reference';
import { findReturnOrigin } from './suggest/return';
import { ruleMatches } from './suggest/rule';
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
export type SuggestionKind = 'linkEntry' | 'transfer' | 'cashTransfer' | 'return' | 'openItem' | 'rule' | 'contact' | 'none';

export interface SuggestionReason {
  kind: 'linkEntry' | 'pair' | 'cashKeyword' | 'returnCode' | 'paymentReference' | 'amountAndContact' | 'rule' | 'contactIban';
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
  confidence: 'sure' | 'unsure';
  reasons: SuggestionReason[];
  /** Vorbelegung für `bookFromTransaction` — `null` bei `linkEntry` und `none`. */
  draft: SuggestionDraft | null;
  linkEntry: { entryId: string; number: string | null; entryDate: string; status: 'draft' | 'final' } | null;
  problems: ('categoryInactive' | 'purposeClosed')[];
  hints: 'foreignIban'[];
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

function loadSuggestionDataInternal(deps: Deps): SuggestionData {
  const db = deps.db;
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
      // Hängt schon ein Settlement daran — auch an einem Entwurf —, ist die Zahlung vergeben (Nachtrag Lauf 2).
      .filter((row) => !openItemHasAnySettlementInternal(db, row.id))
      .map((row) => ({ row, openCents: openCentsInternal(db, row.id) }))
      .filter((i) => i.openCents > 0),
    rules: activeImportRulesInternal(db),
    categories: new Map(categoryRows.map((c) => [c.id, c] as const)),
    categoriesByKey: new Map(categoryRows.map((c) => [c.key, c] as const)),
    purposes: new Map(db.select().from(financePurposes).all().map((p) => [p.id, p] as const)),
    cashAccountIds: db.select({ id: financeAccounts.id }).from(financeAccounts).where(and(eq(financeAccounts.kind, 'cash'), eq(financeAccounts.isActive, true))).orderBy(asc(financeAccounts.createdAt), asc(financeAccounts.id)).all().map((a) => a.id),
  };
}

/** Buchungstext aus den Bankdaten: Gegenpartei und Verwendungszweck; ohne beides das Buchungsdatum. Auch für den leeren Entwurf beim Beleg (`import/vouchers.ts`). */
export function defaultText(raw: FinanceRawTransactionRow): string {
  const text = [raw.counterpartyName, raw.purpose].map((s) => (s ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean).join(' · ');
  return (text || raw.bookingDate).slice(0, 300);
}

const rawLine = (raw: FinanceRawTransactionRow) => ({ accountId: raw.accountId, amountCents: raw.amountCents, rawTransactionId: raw.id });

type AllocationInput = EntryLinesInput['allocationLines'][number];

/** Eine Zuordnungszeile ohne leere Felder — so bleibt die Vorbelegung lesbar. */
function allocation(fields: { categoryId: string; amountCents: number; taxCode?: string | null; projectId?: string | null; purposeId?: string | null; contactId?: string | null; originLineId?: string | null }): AllocationInput {
  const line: Record<string, unknown> = { categoryId: fields.categoryId, amountCents: fields.amountCents };
  for (const key of ['taxCode', 'projectId', 'purposeId', 'contactId', 'originLineId'] as const) if (fields[key]) line[key] = fields[key];
  return line as AllocationInput;
}

/** Zeilenvorlage einer offenen Zahlung (JSON) → Zuordnungszeilen; eine einzelne Zeile bekommt den Betrag des Umsatzes. */
function linesFromTemplate(item: FinanceOpenItemRow, amountCents: number): AllocationInput[] {
  if (!item.lineTemplate) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.lineTemplate);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records = parsed.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && typeof (r as Record<string, unknown>).categoryId === 'string');
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return records.map((r) =>
    allocation({
      categoryId: r.categoryId as string,
      amountCents: records.length === 1 || typeof r.amountCents !== 'number' ? amountCents : (r.amountCents as number),
      taxCode: str(r.taxCode), projectId: str(r.projectId), purposeId: str(r.purposeId), contactId: str(r.contactId) ?? item.contactId,
    }),
  );
}

/** Bei (2): gebundene Umsätze mit den Zuordnungen ihrer Buchung — nur geladen, wenn ein Rückgabe-Code da ist. */
function bookedRawsInternal(db: DbOrTx): (FinanceRawTransactionRow & { entryId: string; entryNumber: string | null; lines: FinanceAllocationLineRow[] })[] {
  const bound = db
    .select({ raw: financeRawTransactions, entryId: financeEntries.id, entryNumber: financeEntries.number })
    .from(financeMoneyLines)
    .innerJoin(financeRawTransactions, eq(financeRawTransactions.id, financeMoneyLines.rawTransactionId))
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .where(and(isNull(financeMoneyLines.rawReleasedAt), isNull(financeEntries.reversedByEntryId)))
    .all();
  if (bound.length === 0) return [];
  const lines = db.select().from(financeAllocationLines).where(inArray(financeAllocationLines.entryId, bound.map((b) => b.entryId))).orderBy(asc(financeAllocationLines.position)).all();
  return bound.map((b) => ({ ...b.raw, entryId: b.entryId, entryNumber: b.entryNumber, lines: lines.filter((l) => l.entryId === b.entryId) }));
}

function problemsOf(data: SuggestionData, draft: SuggestionDraft | null, extra: SuggestionView['problems'] = []): SuggestionView['problems'] {
  const problems = new Set(extra);
  for (const line of draft?.allocationLines ?? []) {
    if (!data.categories.get(line.categoryId)?.isActive) problems.add('categoryInactive');
    const purpose = line.purposeId ? data.purposes.get(line.purposeId) : undefined;
    if (purpose && (!purpose.isActive || purpose.fulfilledAt !== null || purpose.dissolvedAt !== null)) problems.add('purposeClosed');
  }
  return [...problems];
}

type Proposal = Pick<SuggestionView, 'kind' | 'confidence' | 'reasons' | 'draft'> & { linkEntry?: SuggestionView['linkEntry']; extraProblems?: SuggestionView['problems'] };

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
  // (1) Bar-Kennung: Umbuchung gegen die Barkasse.
  const cashAccountId = data.cashAccountIds.find((id) => id !== raw.accountId);
  if (cashAccountId && isCashKeyword(raw.purpose, data.settings.cashKeywords)) {
    return {
      kind: 'cashTransfer', confidence: 'sure',
      reasons: [{ kind: 'cashKeyword', otherAccountId: cashAccountId }],
      draft: draftOf([rawLine(raw), { accountId: cashAccountId, amountCents: -raw.amountCents }], []),
    };
  }

  // (2) Zurückgegebene Zahlung: die Zuordnungen der ursprünglichen Buchung, negiert und mit `originLineId`.
  if (raw.returnCode) {
    const origin = findReturnOrigin(raw, bookedRawsInternal(deps.db));
    const originSum = origin?.lines.reduce((s, l) => s + l.amountCents, 0);
    if (origin && origin.lines.length > 0 && originSum === -raw.amountCents) {
      return {
        kind: 'return', confidence: 'sure',
        reasons: [{ kind: 'returnCode', entryId: origin.entryId, entryNumber: origin.entryNumber }],
        draft: draftOf(
          [rawLine(raw)],
          origin.lines.map((l) => allocation({ categoryId: l.categoryId, amountCents: -l.amountCents, taxCode: l.taxCode, projectId: l.projectId, purposeId: l.purposeId, contactId: l.contactId, originLineId: l.id })),
        ),
      };
    }
  }

  const contactId = raw.counterpartyIban ? (contactForIbanInternal(deps.db, raw.counterpartyIban)?.contactId ?? null) : null;

  // (3) Offene Zahlung: über die Zahlungsreferenz sicher, über Betrag und Kontakt unsicher.
  const kind = raw.amountCents > 0 ? 'receivable' : 'payable';
  const candidates = data.openItems.filter((i) => i.row.kind === kind);
  const settle = (item: OpenItemLike) => draftOf([{ ...rawLine(raw), settlements: [{ openItemId: item.row.id, amountCents: Math.min(Math.abs(raw.amountCents), item.openCents) }] }], linesFromTemplate(item.row, raw.amountCents));
  const byReferenceId = findByReference(raw.purpose, candidates.map((i) => ({ id: i.row.id, paymentReference: i.row.paymentReference })));
  const byReference = byReferenceId ? candidates.find((i) => i.row.id === byReferenceId)! : null;
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
    if (!rule.contactId && contactId) reasons.push({ kind: 'contactIban', contactId });
    return {
      kind: 'rule', confidence: 'sure', reasons,
      draft: draftOf([rawLine(raw)], [allocation({ categoryId: rule.categoryId, amountCents: raw.amountCents, taxCode: rule.taxCode, projectId: rule.projectId, purposeId: rule.purposeId, contactId: lineContact })], rule.entryText ?? defaultText(raw)),
    };
  }

  // (5) Nur der Kontakt ist bekannt — unsicher; bei Eingang mit der Vorgabe-Kategorie.
  if (contactId) {
    const income = raw.amountCents > 0 ? data.categoriesByKey.get(CONTACT_INCOME_CATEGORY_KEY) : undefined;
    return {
      kind: 'contact', confidence: 'unsure', reasons: [{ kind: 'contactIban', contactId }],
      draft: draftOf([rawLine(raw)], income ? [allocation({ categoryId: income.id, amountCents: raw.amountCents, contactId })] : []),
    };
  }

  return { kind: 'none', confidence: 'unsure', reasons: [], draft: null };
}

function suggestInternal(deps: Deps, data: SuggestionData, raw: FinanceRawTransactionRow): SuggestionView {
  const p = proposeInternal(deps, data, raw);
  const hint = paymentServiceHint(raw.counterpartyIban);
  return {
    rawTransactionId: raw.id,
    kind: p.kind,
    confidence: p.confidence,
    reasons: p.reasons,
    draft: p.draft,
    linkEntry: p.linkEntry ?? null,
    problems: problemsOf(data, p.draft, p.extraProblems),
    hints: hint ? [hint] : [],
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
