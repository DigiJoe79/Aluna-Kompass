import { hasPermission, requirePermission } from '@kompass/core';
import { contactRoleDefinitions, displayName, listContacts } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { readSort } from '@/lib/sort';
import { ContactList } from './contact-list';
import { CreateContactDialog } from './contact-form';

/** Die Spalten, nach denen die Liste sortieren darf — mehr nimmt der Service nicht. */
const SORTABLE = ['name', 'kind', 'city', 'createdAt'] as const;
/** Kontakte je Seite — keine stille Grenze mehr (Spec Filterleisten § 3), geblättert über `?page`. */
const PAGE_SIZE = 50;

export default async function ContactsPage(props: {
  searchParams: Promise<{ kind?: string; role?: string; text?: string; archived?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'contacts.view')) return <Page width="full"><ForbiddenCard permission="contacts.view" /></Page>;
  const t = await getTranslations('contacts');
  const q = await props.searchParams;
  const offset = (Math.max(1, Number(q.page) || 1) - 1) * PAGE_SIZE;
  const result = await listContacts(deps, ctx, {
    kind: q.kind === 'person' || q.kind === 'organization' ? q.kind : undefined,
    role: q.role || undefined,
    text: q.text || undefined,
    includeArchived: q.archived === '1',
    orderBy: readSort(q, SORTABLE),
    limit: PAGE_SIZE,
    offset,
  });
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="contacts.view" /></Page>;

  const rows = result.value.contacts.map((c) => ({
    id: c.id,
    kind: c.kind,
    name: displayName(c),
    affiliation: c.belongsTo ? displayName(c.belongsTo) : null,
    roles: c.roles.filter((r) => r.until === null).map((r) => r.role),
    city: c.city ?? '',
    primaryChannel: c.channels.find((ch) => ch.isPrimary)?.value ?? '',
    status: c.status,
  }));

  const hasFilter = Boolean(q.text || q.kind || q.role || q.archived === '1');
  // Die Zählzeile nennt „{Treffer} von {alle}“; „alle“ meint die Kontakte ohne Suche, Art und Rolle — mit
  // „Auch archivierte“ zählen die archivierten mit, sonst stünden mehr Treffer da als Kontakte.
  const all = hasFilter
    ? await listContacts(deps, ctx, { includeArchived: q.archived === '1', limit: 1 })
    : result;
  const unfiltered = all.ok ? all.value.total : result.value.total;
  const roleKeys = [...contactRoleDefinitions(deps).keys()];

  return (
    <Page
      width="full"
      header={
        <PageHeader
          title={t('title')}
          description={t('description')}
          actions={hasPermission(ctx, 'contacts.manage') ? <CreateContactDialog /> : null}
        />
      }
    >
      {rows.length === 0 && !hasFilter ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        <ContactList contacts={rows} roles={roleKeys} total={result.value.total} unfiltered={unfiltered} offset={offset} pageSize={PAGE_SIZE} />
      )}
    </Page>
  );
}
