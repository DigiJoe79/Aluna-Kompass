'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { checkFilter, FilterBar, selectFilter } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { StatusBadge } from '@/components/status-badge';
import { SortableHead } from '@/components/sortable-head';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { roleLabel } from '@/lib/contact-roles';
import { useUrlFilters } from '@/lib/use-url-filters';
import { EmptyState } from '@/components/empty-state';
import { ListPager } from '@/components/list-pager';

export interface ContactListItem {
  id: string;
  kind: 'person' | 'organization';
  name: string;
  affiliation: string | null;
  roles: string[];
  city: string;
  primaryChannel: string;
  status: 'active' | 'archived';
}

export function ContactList({ contacts, roles, total, unfiltered, offset, pageSize }: { contacts: ContactListItem[]; roles: string[]; total: number; unfiltered: number; offset: number; pageSize: number }) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  // Gefiltert wird serverseitig (`listContacts`); die Felder hier setzen nur die
  // Query-Parameter, dieselbe Trennung wie in der Dokumentenliste.
  // Die Felder folgen der Adresse, wenn sie von außen wechselt (Seitenleiste, Zurück-Knopf).
  const [filters, setFilters] = useUrlFilters({
    text: params.get('text') ?? '',
    kind: params.get('kind') ?? '',
    role: params.get('role') ?? '',
    archived: params.get('archived') === '1' ? '1' : '',
  });
  const query = filters.text;
  const kindFilter = filters.kind;
  const roleFilter = filters.role;
  const showArchived = filters.archived === '1';

  // Aus allen vier Feldern zusammen, nicht als Patch auf `params` — sonst geht
  // eine Änderung verloren, wenn zwei Filter im selben Render umgestellt werden.
  const applyFilters = (patch: Partial<{ text: string; kind: string; role: string; archived: boolean }>) => {
    const merged = { text: query, kind: kindFilter, role: roleFilter, archived: showArchived, ...patch };
    setFilters({ text: merged.text, kind: merged.kind, role: merged.role, archived: merged.archived ? '1' : '' });
    const next = new URLSearchParams();
    if (merged.text.trim()) next.set('text', merged.text.trim());
    if (merged.kind) next.set('kind', merged.kind);
    if (merged.role) next.set('role', merged.role);
    if (merged.archived) next.set('archived', '1');
    // Sortierung ist kein Filter, sie überlebt jeden Filterwechsel.
    for (const key of ['sort', 'dir']) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        search={<SearchField value={query} onChange={(text) => applyFilters({ text })} placeholder={t('searchPlaceholder')} />}
        searchActive={query.trim() ? { chip: query.trim(), onClear: () => applyFilters({ text: '' }) } : undefined}
        filters={[
          selectFilter({
            key: 'kind',
            label: t('fields.kind'),
            value: kindFilter,
            options: [
              { value: 'person', label: t('fields.person') },
              { value: 'organization', label: t('fields.organization') },
            ],
            onChange: (kind) => applyFilters({ kind }),
          }),
          selectFilter({ key: 'role', label: t('filterRole'), value: roleFilter, options: roles.map((r) => ({ value: r, label: roleLabel(t, r) })), onChange: (role) => applyFilters({ role }) }),
          checkFilter({ key: 'archived', label: t('includeArchived'), value: showArchived, onChange: (archived) => applyFilters({ archived }) }),
        ]}
        onApply={(values) => applyFilters({ ...values, ...('archived' in values ? { archived: values.archived === '1' } : {}) })}
        count={{ shown: total, total: unfiltered, noun: { one: t('nounOne'), other: t('nounOther'), dative: t('nounDative') } }}
        onReset={() => applyFilters({ text: '', kind: '', role: '', archived: false })}
      />

      {contacts.length === 0 ? (
        // Befund 3: Die Seite zeigt die Liste ohne Treffer nur mit Filter — statt einer leeren Tabelle mit Kopf.
        <EmptyState filtered={{ noun: t('emptyFilteredNoun'), onReset: () => applyFilters({ text: '', kind: '', role: '', archived: false }) }} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead field="name" label={t('columns.name')} />
                <SortableHead field="kind" label={t('columns.kind')} />
                <TableHead>{t('columns.roles')}</TableHead>
                <SortableHead field="city" label={t('columns.city')} />
                <TableHead>{t('columns.contact')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <RowLink href={`/contacts/${c.id}`}>{c.name}</RowLink>
                      {c.affiliation ? (
                        <span className="text-[12px] text-muted-ink">{c.affiliation}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-ink-2">
                    {c.kind === 'organization' ? t('fields.organization') : t('fields.person')}
                    {c.status === 'archived' ? (
                      <StatusBadge tone="neutral" className="ml-2">
                        {t('archived')}
                      </StatusBadge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.roles.map((r) => (
                        <StatusBadge key={r} tone="info">
                          {roleLabel(t, r)}
                        </StatusBadge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-ink-2">{c.city || '—'}</TableCell>
                  <TableCell selectable className="text-ink-2 font-mono text-[13px]">{c.primaryChannel || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPager
            total={total}
            offset={offset}
            pageSize={pageSize}
            hrefFor={(next) => {
              // Filter und Sortierung bleiben, nur die Seite wechselt; ein Filterwechsel baut die Adresse neu (ohne `page`).
              const qs = new URLSearchParams(params.toString());
              const target = Math.floor(next / pageSize) + 1;
              if (target > 1) qs.set('page', String(target));
              else qs.delete('page');
              return qs.toString() ? `${pathname}?${qs.toString()}` : pathname;
            }}
            footer
            testId="contacts-pager"
          />
        </div>
      )}
    </div>
  );
}
