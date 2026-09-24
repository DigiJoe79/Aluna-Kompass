import { ok, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { overdueOpenItemsInternal } from '../ledger/open-items';
import { financeEntries, financeImportCandidates, financeImportRuns, financeMoneyLines, type FinanceEntryRow } from '../schema';
import { rawTransactionViewInternal, type RawTransactionView } from './queries';
import { openSuggestionsInternal, type SuggestionView } from './suggestions';

/**
 * Die Arbeitsliste lesen (F5, Spec 6.4; HANDOFF § 12.5 B1). Fünf Reiter:
 * **Zuzuordnen** (`open`) und **Unsicher** (`unsure`) teilen die offenen
 * Kontoumsätze nach der Sicherheit ihres Vorschlags (Annahme 1: unsicher =
 * `confidence: 'unsure'`, wozu auch „kein Vorschlag“ zählt); **Vom Agenten
 * vorbereitet** (`agent`) sind ungeprüfte MCP-Entwürfe, die einen Kontoumsatz
 * binden (Annahme 11); **Geprüft, nicht festgeschrieben** (`reviewed`) alle
 * geprüften Entwürfe; **Fällig** (`due`) die überfälligen offenen Zahlungen
 * beider Richtungen (Annahme 12). Dubletten-Kandidaten bleiben auf
 * „Hochgeladene Auszüge“ und werden nur gezählt.
 */
export type WorkTab = 'open' | 'unsure' | 'agent' | 'reviewed' | 'due';

/** Die Kurzform eines Vorschlags für die Liste — die Vorbelegung holt die Detailansicht über `suggestForTransaction`. */
export type SuggestionSummary = Pick<SuggestionView, 'kind' | 'confidence' | 'reasons' | 'problems' | 'hints'>;

export interface WorkEntry {
  id: string;
  number: string | null;
  entryDate: string;
  text: string;
  status: 'draft' | 'final';
  reviewedAt: string | null;
  createdChannel: string;
  /** Summe der Geldzeilen. */
  totalCents: number;
  moneyLines: { accountId: string; amountCents: number; rawTransactionId: string | null }[];
}

export interface WorkOpenItem {
  id: string;
  kind: 'receivable' | 'payable';
  itemDate: string;
  dueOn: string | null;
  amountCents: number;
  openCents: number;
  paymentReference: string | null;
  contactId: string | null;
}

export type WorkItem =
  | { type: 'transaction'; transaction: RawTransactionView; suggestion: SuggestionSummary }
  | { type: 'entry'; entry: WorkEntry }
  | { type: 'openItem'; openItem: WorkOpenItem };

export interface WorkCounts {
  open: number;
  unsure: number;
  agent: number;
  reviewed: number;
  due: number;
  /** Zurückgehaltene Zeilen (Dubletten-Kandidaten) aus nicht verworfenen Auszügen — warten unter „Hochgeladene Auszüge“. */
  heldCandidates: number;
}

const listSchema = z.object({
  tab: z.enum(['open', 'unsure', 'agent', 'reviewed', 'due']),
  accountId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const summaryOf = (s: SuggestionView): SuggestionSummary => ({ kind: s.kind, confidence: s.confidence, reasons: s.reasons, problems: s.problems, hints: s.hints });

const today = (deps: Deps): string => deps.clock.now().toISOString().slice(0, 10);

function transactionItemsInternal(deps: Deps, tab: 'open' | 'unsure', accountId?: string): WorkItem[] {
  return openSuggestionsInternal(deps)
    .filter(({ raw, suggestion }) => (accountId === undefined || raw.accountId === accountId) && (suggestion.confidence === 'sure') === (tab === 'open'))
    .map(({ raw, suggestion }) => ({ type: 'transaction', transaction: rawTransactionViewInternal(deps.db, raw), suggestion: summaryOf(suggestion) }));
}

/** Entwürfe mit ihren Geldzeilen; `agent` = ungeprüft über MCP mit gebundenem Kontoumsatz, `reviewed` = geprüft. */
function entryItemsInternal(db: DbOrTx, tab: 'agent' | 'reviewed', accountId?: string): WorkItem[] {
  const drafts: FinanceEntryRow[] = db
    .select()
    .from(financeEntries)
    .where(and(eq(financeEntries.status, 'draft'), tab === 'agent' ? and(eq(financeEntries.createdChannel, 'mcp'), isNull(financeEntries.reviewedAt)) : isNotNull(financeEntries.reviewedAt)))
    .orderBy(asc(financeEntries.entryDate), asc(financeEntries.createdAt))
    .all();
  if (drafts.length === 0) return [];
  const lines = db
    .select({ entryId: financeMoneyLines.entryId, accountId: financeMoneyLines.accountId, amountCents: financeMoneyLines.amountCents, rawTransactionId: financeMoneyLines.rawTransactionId, rawReleasedAt: financeMoneyLines.rawReleasedAt })
    .from(financeMoneyLines)
    .where(inArray(financeMoneyLines.entryId, drafts.map((d) => d.id)))
    .orderBy(asc(financeMoneyLines.position))
    .all();
  const items: WorkItem[] = [];
  for (const d of drafts) {
    const own = lines.filter((l) => l.entryId === d.id);
    if (tab === 'agent' && !own.some((l) => l.rawTransactionId !== null && l.rawReleasedAt === null)) continue;
    if (accountId !== undefined && !own.some((l) => l.accountId === accountId)) continue;
    items.push({
      type: 'entry',
      entry: {
        id: d.id, number: d.number, entryDate: d.entryDate, text: d.text, status: d.status as 'draft' | 'final', reviewedAt: d.reviewedAt, createdChannel: d.createdChannel,
        totalCents: own.reduce((s, l) => s + l.amountCents, 0),
        moneyLines: own.map((l) => ({ accountId: l.accountId, amountCents: l.amountCents, rawTransactionId: l.rawTransactionId })),
      },
    });
  }
  return items;
}

function dueItemsInternal(deps: Deps): WorkItem[] {
  return overdueOpenItemsInternal(deps.db, today(deps))
    .sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || a.id.localeCompare(b.id))
    .map((r) => ({
      type: 'openItem',
      openItem: { id: r.id, kind: r.kind as 'receivable' | 'payable', itemDate: r.itemDate, dueOn: r.dueOn, amountCents: r.amountCents, openCents: r.openCents, paymentReference: r.paymentReference, contactId: r.contactId },
    }));
}

function itemsFor(deps: Deps, tab: WorkTab, accountId?: string): WorkItem[] {
  if (tab === 'open' || tab === 'unsure') return transactionItemsInternal(deps, tab, accountId);
  if (tab === 'agent' || tab === 'reviewed') return entryItemsInternal(deps.db, tab, accountId);
  return dueItemsInternal(deps);
}

/** `finance.read`: Bankdaten, Buchungstexte, Kontakte. `accountId` filtert Umsätze und Entwürfe, nicht die fälligen Zahlungen. */
export async function listWorkItems(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: WorkItem[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const all = itemsFor(deps, v.tab, v.accountId);
  return ok({ items: all.slice(v.offset, v.offset + v.limit), total: all.length });
}

/** `finance.read`: die Zähl-Pillen der Reiter und die Hinweiszeile „zurückgehaltene Zeilen“. */
export async function getWorkCounts(deps: Deps, ctx: CallContext): Promise<Result<WorkCounts>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const suggestions = openSuggestionsInternal(deps);
  const sure = suggestions.filter((s) => s.suggestion.confidence === 'sure').length;
  const heldCandidates = deps.db
    .select({ id: financeImportCandidates.id })
    .from(financeImportCandidates)
    .innerJoin(financeImportRuns, eq(financeImportRuns.id, financeImportCandidates.runId))
    .where(and(isNull(financeImportCandidates.decision), isNull(financeImportRuns.discardedAt)))
    .all().length;
  return ok({
    open: sure,
    unsure: suggestions.length - sure,
    agent: entryItemsInternal(deps.db, 'agent').length,
    reviewed: entryItemsInternal(deps.db, 'reviewed').length,
    due: dueItemsInternal(deps).length,
    heldCandidates,
  });
}
