import { invalid, notFound, ok, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { liveEntry, passedOnCentsInternal } from '../ledger/foreign-money';
import type { EntryView } from '../ledger/entries';
import { START_PLAN } from '../ledger/start-plan';
import { financeAllocationLines, financeCategories, financeEntries } from '../schema';
import { bookFromTransaction, usableRawInternal } from './book';

/**
 * „Gehört nicht dem Verein“ (F5, Annahme 4): Geld, das der Verein nur
 * weiterreicht — eine Sammelbestellung für den Nachbarverein, eine Spende,
 * die an jemand anderen geht. Gebucht auf die Startplan-Kategorie `not-ours`
 * (`direction: 'transit'`), der Pflichttext „Für wen ist das Geld?“ steht im
 * Buchungstext — nie im Protokoll, denn `text` steht in keiner Whitelist.
 * Die Rückzahlung ist eine zweite Buchung auf dieselbe Kategorie, deren
 * Zuordnung mit `originLineId` auf die Eingangszeile zeigt.
 */
const NOT_OURS_KEY = 'not-ours';
/** Der feste Anfang des Buchungstexts — `listForeignMoney` liest den Rest als „für wen“. */
const HOLDER_PREFIX = 'Fremdes Geld für: ';

const markSchema = z.object({
  rawTransactionId: z.string().min(1),
  /** Pflicht, aber als Fachfehler `foreignNeedsHolder` gemeldet, nicht als Feldfehler — die Abhilfe sagt, wozu der Satz dient. */
  holder: z.string().max(200).default(''),
  /** Bei einer Rückzahlung: die Zuordnungszeile des früheren Eingangs. */
  returnsLineId: z.string().min(1).optional(),
  reviewed: z.boolean(),
  /** Wie bei `bookFromTransaction`: der Entwurf, den die Arbeitsliste zeigte. */
  expectedDraftId: z.string().min(1).optional(),
});

export interface ForeignMoneyItem {
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  /** Der Eingang. */
  amountCents: number;
  /** AF: Summe der Weitergaben, die auf den Eingang zeigen (positiv). */
  passedOnCents: number;
  /** AF: Eingang − Weitergaben — offen ist, was noch nicht weitergegeben ist. */
  openCents: number;
  /** Der Buchungstext ohne den festen Anfang — „für wen“. */
  holderText: string;
  lineId: string;
}

/**
 * `finance.entriesWrite`; mit `reviewed: true` **`humanOnly`** wie
 * `bookFromTransaction`, das hier bucht. Fehlt die Kategorie `not-ours` (vom
 * Verein gelöscht), wird das wie eine stillgelegte gemeldet — mit ihrem Namen
 * aus dem Startplan.
 */
export async function markTransactionForeign(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, markSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const holder = v.holder.trim().replace(/\s+/g, ' ');
  if (!holder) return financeConflict('foreignNeedsHolder');

  const loaded = usableRawInternal(deps.db, v.rawTransactionId);
  if (!loaded.ok) return loaded;
  const raw = loaded.value;

  const category = deps.db.select().from(financeCategories).where(eq(financeCategories.key, NOT_OURS_KEY)).get();
  if (!category) return financeConflict('categoryInactive', { category: START_PLAN.find((c) => c.key === NOT_OURS_KEY)?.name ?? NOT_OURS_KEY });

  if (v.returnsLineId) {
    const origin = deps.db.select({ categoryId: financeAllocationLines.categoryId, amountCents: financeAllocationLines.amountCents }).from(financeAllocationLines).where(eq(financeAllocationLines.id, v.returnsLineId)).get();
    if (!origin) return notFound('financeAllocationLine', v.returnsLineId);
    // Nur ein Eingang fremden Gelds lässt sich zurückzahlen, und nur mit einem Ausgang.
    if (origin.categoryId !== category.id || origin.amountCents <= 0 || raw.amountCents >= 0) return invalid([{ path: 'returnsLineId', message: 'notForeignMoneyReceipt' }]);
    // AF: nie mehr weitergeben, als vom Eingang offen ist — der Rest wäre Geld des Vereins.
    const open = origin.amountCents - passedOnCentsInternal(deps.db, v.returnsLineId);
    if (-raw.amountCents > open) return financeConflict('foreignMoneyOverpaid', { amount: -raw.amountCents, open });
  }

  return bookFromTransaction(deps, ctx, {
    rawTransactionId: raw.id,
    text: `${HOLDER_PREFIX}${holder}`.slice(0, 300),
    allocationLines: [{ categoryId: category.id, amountCents: raw.amountCents, ...(v.returnsLineId ? { originLineId: v.returnsLineId } : {}) }],
    reviewed: v.reviewed,
    ...(v.expectedDraftId ? { expectedDraftId: v.expectedDraftId } : {}),
  });
}

/**
 * `finance.read` (Buchungstexte): „Fremdes Geld, noch nicht weitergegeben“ —
 * Eingänge auf einer `transit`-Kategorie (Betrag > 0) an Buchungen, die weder
 * zurückgenommen noch selbst eine Rücknahme sind, solange die Weitergaben (Zeilen,
 * die mit `originLineId` auf sie zeigen) den Betrag nicht decken (AF: nach Betrag,
 * nicht nur nach Verweis). Entwürfe zählen mit: Das Geld ist da, ob die
 * Buchung schon festgeschrieben ist oder nicht.
 */
export async function listForeignMoney(deps: Deps, ctx: CallContext): Promise<Result<{ items: ForeignMoneyItem[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const transit = deps.db.select({ id: financeCategories.id }).from(financeCategories).where(eq(financeCategories.direction, 'transit')).all().map((c) => c.id);
  if (transit.length === 0) return ok({ items: [] });

  const receipts = deps.db
    .select({ lineId: financeAllocationLines.id, amountCents: financeAllocationLines.amountCents, entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate, text: financeEntries.text })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .where(and(inArray(financeAllocationLines.categoryId, transit), liveEntry()))
    .orderBy(asc(financeEntries.entryDate), asc(financeEntries.createdAt))
    .all()
    .filter((r) => r.amountCents > 0);
  const passedOn = new Map<string, number>();
  for (const r of deps.db
    .select({ originLineId: financeAllocationLines.originLineId, amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .where(and(isNotNull(financeAllocationLines.originLineId), liveEntry()))
    .all()) {
    passedOn.set(r.originLineId!, (passedOn.get(r.originLineId!) ?? 0) - r.amountCents);
  }
  return ok({
    items: receipts
      .map((r) => {
        const passedOnCents = passedOn.get(r.lineId) ?? 0;
        return { entryId: r.entryId, entryNumber: r.entryNumber, entryDate: r.entryDate, amountCents: r.amountCents, passedOnCents, openCents: r.amountCents - passedOnCents, holderText: r.text.startsWith(HOLDER_PREFIX) ? r.text.slice(HOLDER_PREFIX.length) : r.text, lineId: r.lineId };
      })
      .filter((item) => item.openCents > 0),
  });
}
