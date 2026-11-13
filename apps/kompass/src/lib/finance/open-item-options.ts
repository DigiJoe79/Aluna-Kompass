import type { CallContext, Deps } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import type { OpenItemView } from '@kompass/module-finance';
import type { SettlementOption } from './settlement';

/** Namen zu Kontakt-IDs (`getContact` + `displayName`); was der Aufrufer nicht sehen darf oder was fehlt, bleibt weg. */
export async function contactNamesOf(deps: Deps, ctx: CallContext, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = new Set<string>();
  for (const id of ids) if (id) wanted.add(id);
  await Promise.all(
    [...wanted].map(async (id) => {
      const res = await getContact(deps, ctx, id);
      if (res.ok) names.set(id, displayName(res.value));
    }),
  );
  return names;
}

/**
 * Die offenen Posten als Auswahl „begleicht offene Zahlung“ der Buchungsmaske: Referenz, Kontakt mit Namen (wie die
 * Liste der offenen Zahlungen, `getContact` + `displayName`) und die Vorlage für „Wofür?“ — der Kontakt einer
 * Vorlagenzeile fällt wie in `linesFromTemplate` auf den des Postens zurück.
 */
export async function settlementOptions(deps: Deps, ctx: CallContext, items: readonly OpenItemView[], unnamed: (itemDate: string) => string): Promise<SettlementOption[]> {
  const names = await contactNamesOf(deps, ctx, items.flatMap((item) => [item.contactId, ...(item.lineTemplate ?? []).map((line) => line.contactId)]));
  return items.map((item) => ({
    id: item.id,
    kind: item.kind as 'receivable' | 'payable',
    label: item.paymentReference ?? unnamed(item.itemDate),
    contactName: item.contactId ? (names.get(item.contactId) ?? null) : null,
    openCents: item.openCents,
    lineTemplate: item.lineTemplate
      ? item.lineTemplate.map((line) => {
          const contactId = line.contactId ?? item.contactId ?? null;
          return { ...line, contactId, contactName: contactId ? (names.get(contactId) ?? null) : null };
        })
      : null,
  }));
}
