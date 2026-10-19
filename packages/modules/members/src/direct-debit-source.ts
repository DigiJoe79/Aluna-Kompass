import type { DirectDebitSourceItem, Deps } from '@kompass/core';
import { financeOpenItems, openCentsInternal } from '@kompass/module-finance';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { mandateForChargeInternal } from './payment-method';
import { memberFeeCharges } from './schema';

/**
 * Haken `directDebitSources` (Plan L2 Task 1): offene Beiträge, die per Lastschrift eingezogen werden — der Posten
 * fällig bis `until` (eine Stundung verschiebt seine Fälligkeit), nicht storniert, mit offenem Rest, mit dem Zahlweg
 * Lastschrift am Beitrag (Plan N1 E3 — ein Beitrag, zu dem ein Brief zur Überweisung aufforderte, bleibt draußen), und die
 * Vereinbarung, die am Tag gilt, nennt ein Mandat. Den Zustand des Mandats prüft die Vorschau des
 * Einzugs; sie nennt den Grund, wenn nicht eingezogen werden darf.
 */
export function membersDirectDebitSources(deps: Deps, input: { until: string }): DirectDebitSourceItem[] {
  const rows = deps.db
    .select({ charge: memberFeeCharges, item: financeOpenItems })
    .from(memberFeeCharges)
    .innerJoin(financeOpenItems, eq(financeOpenItems.id, memberFeeCharges.openItemId))
    .where(and(eq(memberFeeCharges.state, 'created'), isNotNull(memberFeeCharges.openItemId), isNull(financeOpenItems.cancelledAt)))
    .all();
  const out: DirectDebitSourceItem[] = [];
  for (const { charge, item } of rows) {
    const dueOn = item.dueOn ?? charge.deferredTo ?? charge.dueOn;
    if (dueOn > input.until || (charge.deferredTo !== null && charge.deferredTo > input.until)) continue;
    const mandateId = mandateForChargeInternal(deps.db, charge, input.until);
    if (!mandateId) continue;
    const openCents = openCentsInternal(deps.db, item.id);
    if (openCents <= 0) continue;
    out.push({ openItemId: item.id, mandateId, amountCents: openCents, dueOn, remittance: item.paymentReference ?? '' });
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.openItemId.localeCompare(b.openItemId));
}
