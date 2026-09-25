import { notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeText, ruleMatches } from '../rules-pure';
import { financeAllocationLines, financeCategories, financeEntries, financeExpenseClaims, financeExpensePositions, financeImportRules, type FinanceExpensePositionRow } from '../schema';

/**
 * Kategorievorschlag der Freigabe (F8a Annahme 8): je Position erst die
 * aktiven Regeln aus F5 (`ruleMatches` vom neutralen Boden; die Regelzeilen
 * direkt aus `financeImportRules` in derselben Reihenfolge wie
 * `activeImportRulesInternal`, weil `allocation/` `import/` nicht kennen darf),
 * sonst die Kategorie der jüngsten festgeschriebenen Ausgabezeile mit
 * ähnlichem Text. Nie Pflicht, nie gespeichert — der Mensch entscheidet.
 */
export type ExpenseCategorySuggestion = {
  positionId: string;
  categoryId: string;
  reason: { kind: 'rule'; ruleName: string } | { kind: 'similarEntry'; entryNumber: string };
};

const schema = z.object({ claimId: z.string().min(1) });

/** Der Text einer Position für den Vergleich: „Wofür“ und bei Fahrten der Anlass. */
const positionText = (p: FinanceExpensePositionRow) => [p.purpose, p.tripReason ?? ''].join(' ').trim();

/** Wörter ab fünf Zeichen, gefaltet wie `normalizeText` — kurze Füllwörter („für“, „die“) tragen keinen Vergleich. */
const words = (s: string) => [...new Set(s.split(/[^\p{L}\p{N}]+/u).map(normalizeText).filter((w) => w.length >= 5))];

function byRule(db: DbOrTx, p: FinanceExpensePositionRow, iban: string | null): ExpenseCategorySuggestion | null {
  const rules = db.select().from(financeImportRules).where(eq(financeImportRules.isActive, true)).orderBy(asc(financeImportRules.sortOrder), asc(financeImportRules.createdAt)).all();
  const target = { bookingDate: p.positionDate ?? '', accountId: '', amountCents: -p.amountCents, counterpartyName: null, counterpartyIban: iban, purpose: positionText(p) };
  const rule = rules.find((r) => ruleMatches(r, target));
  return rule ? { positionId: p.id, categoryId: rule.categoryId, reason: { kind: 'rule', ruleName: rule.name } } : null;
}

function bySimilarEntry(db: DbOrTx, p: FinanceExpensePositionRow): ExpenseCategorySuggestion | null {
  const wanted = words(positionText(p));
  if (wanted.length === 0) return null;
  const rows = db
    .select({ number: financeEntries.number, text: financeEntries.text, categoryId: financeAllocationLines.categoryId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .where(and(eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId), lt(financeAllocationLines.amountCents, 0), eq(financeCategories.direction, 'expense'), eq(financeCategories.isActive, true)))
    .orderBy(desc(financeEntries.entryDate), desc(financeEntries.number), asc(financeAllocationLines.position))
    .all();
  const hit = rows.find((r) => { const text = normalizeText(r.text); return wanted.some((w) => text.includes(w)); });
  return hit?.number ? { positionId: p.id, categoryId: hit.categoryId, reason: { kind: 'similarEntry', entryNumber: hit.number } } : null;
}

/** `finance.approve`: Vorschläge für die Positionen eines Antrags; Positionen ohne Treffer fehlen. */
export async function suggestExpenseCategories(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseCategorySuggestion[]>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const claim = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, parsed.value.claimId)).get();
  if (!claim) return notFound('financeExpenseClaim', parsed.value.claimId);
  const positions = deps.db.select().from(financeExpensePositions).where(eq(financeExpensePositions.claimId, claim.id)).orderBy(asc(financeExpensePositions.sortOrder)).all();
  return ok(positions.map((p) => byRule(deps.db, p, claim.iban) ?? bySimilarEntry(deps.db, p)).filter((s): s is ExpenseCategorySuggestion => s !== null));
}
