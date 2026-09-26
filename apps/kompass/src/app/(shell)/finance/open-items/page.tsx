import { hasPermission, listUserNamesWithPermission } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { epcQrPayload, listContactIbans, listOpenItems, listOpenItemSettlements } from '@kompass/module-finance';
import { ForbiddenCard } from '@/components/forbidden-card';
import { requireSession } from '@/lib/request-context';
import { openItemState } from '@/lib/finance/open-item-state';
import { DetailSheet } from './detail-sheet';
import { OpenItemsList, type OpenItemRow } from './list';

export interface OpenItemsQuery {
  tab?: string;
  item?: string;
}

export default async function FinanceOpenItemsPage({ searchParams }: { searchParams: Promise<OpenItemsQuery> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;

  const query = await searchParams;
  const tab: 'receivable' | 'payable' = query.tab === 'receivable' ? 'receivable' : 'payable';

  const itemsRes = await listOpenItems(deps, ctx, { state: 'all', limit: 200 });
  if (!itemsRes.ok) return <ForbiddenCard permission="finance.read" />;
  const allItems = itemsRes.value.items;

  const contactIds = new Set(allItems.map((i) => i.contactId).filter((id): id is string => !!id));
  const contactNames = new Map<string, string>();
  await Promise.all(
    [...contactIds].map(async (id) => {
      const res = await getContact(deps, ctx, id);
      if (res.ok) contactNames.set(id, displayName(res.value));
    }),
  );

  const today = deps.clock.now().toISOString().slice(0, 10);
  const rows: OpenItemRow[] = allItems
    .filter((i) => i.kind === tab)
    .map((i) => {
      const state = openItemState(i, today);
      return {
        id: i.id,
        kind: i.kind as 'receivable' | 'payable',
        dueOn: i.dueOn,
        contactLabel: i.contactId ? (contactNames.get(i.contactId) ?? null) : null,
        amountCents: i.amountCents,
        openCents: i.openCents,
        hasOrigin: i.originType !== null,
        paymentReference: i.paymentReference,
        word: state.word,
        overdue: state.overdue,
        draftSettlementCents: i.draftSettlementCents,
      };
    });

  const canWrite = hasPermission(ctx, 'finance.entriesWrite');
  const canFinalize = hasPermission(ctx, 'finance.entriesFinalize');
  const canCreateContact = hasPermission(ctx, 'contacts.manage');
  const finalizeNames = canFinalize ? [] : listUserNamesWithPermission(deps, 'finance.entriesFinalize');

  const selected = query.item ? allItems.find((i) => i.id === query.item) : undefined;
  const settlementsRes = selected ? await listOpenItemSettlements(deps, ctx, { openItemId: selected.id }) : null;

  // N5: die IBAN kommt aus der gelernten Zuordnung des Kontakts (`listContactIbans`) — der Posten selbst trägt keine.
  // Die jüngste Zuordnung gewinnt (`listContactIbans` sortiert aufsteigend nach `createdAt`).
  let contactIban: string | null = null;
  if (selected?.contactId) {
    const ibansRes = await listContactIbans(deps, ctx, { contactId: selected.contactId });
    const ibans = ibansRes.ok ? ibansRes.value.items : [];
    contactIban = ibans.length > 0 ? ibans[ibans.length - 1]!.iban : null;
  }
  const selectedLabel = selected?.contactId ? (contactNames.get(selected.contactId) ?? null) : null;
  const epcPayload =
    selected && contactIban
      ? epcQrPayload({ recipient: selectedLabel ?? '', iban: contactIban, amountCents: selected.openCents, reference: selected.paymentReference ?? '' })
      : null;

  return (
    <>
      <OpenItemsList rows={rows} tab={tab} canWrite={canWrite} canCreateContact={canCreateContact} today={today} />
      {selected ? (
        <DetailSheet
          item={{
            id: selected.id,
            expectedVersion: selected.updatedAt,
            kind: selected.kind as 'receivable' | 'payable',
            itemDate: selected.itemDate,
            contactId: selected.contactId,
            contactLabel: selectedLabel,
            amountCents: selected.amountCents,
            openCents: selected.openCents,
            dueOn: selected.dueOn,
            paymentReference: selected.paymentReference,
            originType: selected.originType,
            cancelledAt: selected.cancelledAt,
            draftSettlementCents: selected.draftSettlementCents,
          }}
          settlements={settlementsRes?.ok ? settlementsRes.value : []}
          canWrite={canWrite}
          canFinalize={canFinalize}
          finalizeNames={finalizeNames}
          canCreateContact={canCreateContact}
          today={today}
          iban={contactIban}
          epcPayload={epcPayload}
        />
      ) : null}
    </>
  );
}
