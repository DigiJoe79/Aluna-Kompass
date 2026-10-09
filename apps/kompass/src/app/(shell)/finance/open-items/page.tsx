import { hasPermission, listUserNamesWithPermission, todayIn } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { epcQrPayload, listContactIbans, listOpenItems, listOpenItemSettlements } from '@kompass/module-finance';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { requireSession } from '@/lib/request-context';
import { openItemState } from '@/lib/finance/open-item-state';
import { readAllPages } from '@/lib/read-all-pages';
import { DetailSheet } from './detail-sheet';
import { OpenItemsList, type OpenItemRow } from './list';

export interface OpenItemsQuery {
  tab?: string;
  item?: string;
  page?: string;
}

/** Posten je Seite und Reiter — bis 0.2.8 eine stille Grenze bei 200 über beide Reiter (Inventar Filterleisten, Befund 10). */
const PAGE_SIZE = 50;

export default async function FinanceOpenItemsPage({ searchParams }: { searchParams: Promise<OpenItemsQuery> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;

  const query = await searchParams;
  const tab: 'receivable' | 'payable' = query.tab === 'receivable' ? 'receivable' : 'payable';

  const page = Math.max(1, Number(query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  // Je Reiter getrennt geblättert. Ein Verweis mit `?item=` (Buchung, Rechnungskarte, Arbeitsliste) kann auf einen
  // Posten einer anderen Seite oder des anderen Reiters zeigen: Dann sucht ihn der zweite Aufruf wie bis 0.2.8.
  const itemsRes = await listOpenItems(deps, ctx, { kind: tab, state: 'all', limit: PAGE_SIZE, offset });
  if (!itemsRes.ok) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const pageItems = itemsRes.value.items;
  // Über alle Seiten (MUSTER § L, `readAllPages`): Mit `limit: 200` verfehlte der Verweis jeden Posten jenseits der
  // ersten 200 (Befund 36, 0.2.9).
  const lookupRes = query.item && !pageItems.some((i) => i.id === query.item) ? await readAllPages((p) => listOpenItems(deps, ctx, { state: 'all', ...p }), (v) => v.items) : null;
  const allItems = [...pageItems, ...(lookupRes?.ok ? lookupRes.value.filter((i) => i.id === query.item) : [])];

  const contactIds = new Set(allItems.map((i) => i.contactId).filter((id): id is string => !!id));
  const contactNames = new Map<string, string>();
  await Promise.all(
    [...contactIds].map(async (id) => {
      const res = await getContact(deps, ctx, id);
      if (res.ok) contactNames.set(id, displayName(res.value));
    }),
  );

  const today = todayIn(deps);
  const rows: OpenItemRow[] = pageItems
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
    <Page width="full">
      <OpenItemsList rows={rows} tab={tab} page={page} total={itemsRes.value.total} pageSize={PAGE_SIZE} canWrite={canWrite} canCreateContact={canCreateContact} today={today} />
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
    </Page>
  );
}
