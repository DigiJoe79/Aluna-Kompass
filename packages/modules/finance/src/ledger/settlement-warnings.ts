import type { DbOrTx } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { bookedItemLinesInternal } from '../direct-debit/booking';
import { unreturnedRunItemsInternal } from '../direct-debit/run-items';
import { financeDirectDebitItems, financeOpenItems } from '../schema';
import { openCentsInternal } from './open-items';

/**
 * Plan N2 Task 2 (R2, R3; E4, M16/M17): Was ein Ausgleich verbergen würde — dieselben Probleme wie im Vorschlag der
 * Arbeitsliste (`import/suggestions.ts`), jetzt an jedem Entwurf berechnet, nie gespeichert. Festschreiben verlangt
 * dafür eine ausdrückliche Bestätigung (`acknowledgedWarnings`).
 *
 * - `inSubmittedRun`: Ein ausgeglichener Posten steckt in einem eingereichten Einzug, dessen Gutschrift noch nicht
 *   gebucht und der nicht zurückgegeben ist — die Bank zieht ihn trotzdem ein. Die Gutschrift dieses Einzugs selbst
 *   (eine Zeile der Buchung trägt den Posten des Einzugs) ist kein Fall.
 * - `overpaid`: Der Ausgleich übersteigt den offenen Betrag, oder die Aufteilung legt mehr auf die Kategorien der
 *   ausgeglichenen Posten, als ausgeglichen wird — der Rest würde still zum Beitrag.
 */
export const SETTLEMENT_WARNINGS = ['inSubmittedRun', 'overpaid'] as const;
export type SettlementWarning = (typeof SETTLEMENT_WARNINGS)[number];
export interface SettlementWarningParams {
  inSubmittedRun?: { date: string };
  /**
   * `via` (U5, Plan N3): `directDebit`, wenn die Gutschrift eines Einzugs einen schon anders bezahlten Posten trägt —
   * der Satz rät dann zu Rückgabe oder Erstattung statt zu einer eigenen Zeile; sonst `payment`.
   */
  overpaid?: { amountCents: number; via: 'payment' | 'directDebit' };
}

interface LinesLike {
  moneyLines: readonly { amountCents: number; settlements: readonly { openItemId: string; amountCents: number; reversesSettlementId: string | null }[] }[];
  allocationLines: readonly { categoryId: string; amountCents: number; directDebitItemId: string | null }[];
}

function templateCategories(lineTemplate: string | null): string[] {
  if (!lineTemplate) return [];
  try {
    const parsed: unknown = JSON.parse(lineTemplate);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((r) => (typeof r === 'object' && r !== null && typeof (r as { categoryId?: unknown }).categoryId === 'string' && (r as { categoryId: string }).categoryId ? [(r as { categoryId: string }).categoryId] : []));
  } catch {
    return [];
  }
}

/** Was die Zeilen einer Gutschrift über den offenen Betrag ihrer Beiträge hinaus tragen (Posten je Einzug summiert). */
function collectedTwiceCents(db: DbOrTx, lines: LinesLike): number {
  const byItem = new Map<string, number>();
  for (const l of lines.allocationLines) if (l.directDebitItemId && l.amountCents > 0) byItem.set(l.directDebitItemId, (byItem.get(l.directDebitItemId) ?? 0) + l.amountCents);
  let twice = 0;
  for (const [itemId, cents] of byItem) {
    const item = db.select({ source: financeDirectDebitItems.source, sourceId: financeDirectDebitItems.sourceId }).from(financeDirectDebitItems).where(eq(financeDirectDebitItems.id, itemId)).get();
    if (item?.source !== 'openItem') continue;
    twice += Math.max(0, cents - Math.max(openCentsInternal(db, item.sourceId), 0));
  }
  return twice;
}

/** Die Warnungen eines Entwurfs aus seinen Zeilen; ohne Rechteprüfung. Ein Rück-Ausgleich zählt nicht. */
export function settlementWarningsInternal(db: DbOrTx, lines: LinesLike): { warnings: SettlementWarning[]; params: SettlementWarningParams } {
  const warnings: SettlementWarning[] = [];
  const params: SettlementWarningParams = {};
  const ownRunItems = new Set(lines.allocationLines.map((l) => l.directDebitItemId).filter((id): id is string => !!id));
  let settledCents = 0;
  let effectiveCents = 0;
  let sign = 0;
  const categories = new Set<string>();
  for (const money of lines.moneyLines) {
    for (const s of money.settlements) {
      if (s.reversesSettlementId) continue;
      const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, s.openItemId)).get();
      if (!item) continue;
      sign = Math.sign(money.amountCents);
      settledCents += s.amountCents;
      effectiveCents += Math.min(s.amountCents, Math.max(openCentsInternal(db, item.id), 0));
      for (const c of templateCategories(item.lineTemplate)) categories.add(c);
      if (!params.inSubmittedRun) {
        const submitted = unreturnedRunItemsInternal(db, { source: 'openItem', sourceId: item.id })
          .filter((r) => r.status === 'submitted' && !ownRunItems.has(r.item.id))
          .find((r) => bookedItemLinesInternal(db, [r.item.id]).length === 0);
        if (submitted) params.inSubmittedRun = { date: submitted.collectionDate };
      }
    }
  }
  if (params.inSubmittedRun) warnings.push('inSubmittedRun');
  const onCategories = lines.allocationLines.filter((l) => categories.has(l.categoryId) && Math.sign(l.amountCents) === sign).reduce((s, l) => s + Math.abs(l.amountCents), 0);
  // U5 (Plan N3): Die Gutschrift eines Einzugs trägt einen Beitrag, der schon anders bezahlt ist — auch ohne jeden
  // Ausgleich in der Buchung (die Bank hat ihn trotzdem eingezogen).
  const twice = collectedTwiceCents(db, lines);
  const over = Math.max(settledCents - effectiveCents, onCategories - effectiveCents, twice, 0);
  if ((settledCents > 0 || twice > 0) && over > 0) {
    warnings.push('overpaid');
    params.overpaid = { amountCents: over, via: twice > 0 || (ownRunItems.size > 0 && sign > 0) ? 'directDebit' : 'payment' };
  }
  return { warnings, params };
}
