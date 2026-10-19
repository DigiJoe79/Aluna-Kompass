import type { CallContext, Deps } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import type { OpenItemView } from '@kompass/module-finance';
import type { SettlementOption } from './settlement';

/**
 * Die offenen Posten als Auswahl „begleicht offene Zahlung“ der Buchungsmaske: Referenz, Kontakt mit Namen (wie die
 * Liste der offenen Zahlungen, `getContact` + `displayName`) und die Vorlage für „Wofür?“ — der Kontakt einer
 * Vorlagenzeile fällt wie in `linesFromTemplate` auf den des Postens zurück.
 */
export async function settlementOptions(deps: Deps, ctx: CallContext, items: readonly OpenItemView[], unnamed: (itemDate: string) => string): Promise<SettlementOption[]> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.contactId) ids.add(item.contactId);
    for (const line of item.lineTemplate ?? []) if (line.contactId) ids.add(line.contactId);
  }
  const names = new Map<string, string>();
  await Promise.all(
    [...ids].map(async (id) => {
      const res = await getContact(deps, ctx, id);
      if (res.ok) names.set(id, displayName(res.value));
    }),
  );
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
