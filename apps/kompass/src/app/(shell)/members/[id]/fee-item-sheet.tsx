import { hasPermission, listUserNamesWithPermission, todayIn, type CallContext, type Deps } from '@kompass/core';
import { listOpenItems, listOpenItemSettlements } from '@kompass/module-finance';
import { readAllPages } from '@/lib/read-all-pages';
import { DetailSheet } from '../../finance/open-items/detail-sheet';

/**
 * Das Seitenfenster der offenen Zahlung zu einem Beitrag (Handoff Mitglieder 2.3, 098) — derselbe Baustein wie in
 * „Offene Zahlungen“, geöffnet über `?item=`. Nur mit `finance.read`; sonst bleibt die Beitragszeile Text.
 */
export async function FeeItemSheet({ deps, ctx, itemId, contactLabel }: { deps: Deps; ctx: CallContext; itemId: string; contactLabel: string }) {
  if (!hasPermission(ctx, 'finance.read')) return null;
  const items = await readAllPages((page) => listOpenItems(deps, ctx, { state: 'all', ...page }), (v) => v.items);
  const item = items.ok ? items.value.find((i) => i.id === itemId) : undefined;
  if (!item) return null;
  const settlements = await listOpenItemSettlements(deps, ctx, { openItemId: item.id });
  const canFinalize = hasPermission(ctx, 'finance.entriesFinalize');
  return (
    <DetailSheet
      item={{
        id: item.id,
        expectedVersion: item.updatedAt,
        kind: item.kind as 'receivable' | 'payable',
        itemDate: item.itemDate,
        contactId: item.contactId,
        contactLabel,
        amountCents: item.amountCents,
        openCents: item.openCents,
        dueOn: item.dueOn,
        paymentReference: item.paymentReference,
        originType: item.originType,
        originId: item.originId,
        cancelledAt: item.cancelledAt,
        draftSettlementCents: item.draftSettlementCents,
      }}
      settlements={settlements.ok ? settlements.value : []}
      canWrite={hasPermission(ctx, 'finance.entriesWrite')}
      canFinalize={canFinalize}
      finalizeNames={canFinalize ? [] : listUserNamesWithPermission(deps, 'finance.entriesFinalize')}
      canCreateContact={hasPermission(ctx, 'contacts.manage')}
      today={todayIn(deps)}
      iban={null}
      epcPayload={null}
    />
  );
}
