'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SortableHead } from '@/components/sortable-head';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { roleLabel } from '@/lib/contact-roles';
import { useUrlFilters } from '@/lib/use-url-filters';
import { Select } from '@/components/ui/select';

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

export function ContactList({ contacts, roles }: { contacts: ContactListItem[]; roles: string[] }) {
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
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t('search')}
          placeholder={t('search')}
          value={query}
          onChange={(e) => {
            applyFilters({ text: e.target.value });
          }}
          className="w-[260px]"
        />
        <Select
          aria-label={t('fields.kind')}
          value={kindFilter}
          onChange={(e) => {
            const val = e.target.value;
            applyFilters({ kind: val });
          }}
          className="w-auto"
        >
          <option value="">{t('allKinds')}</option>
          <option value="person">{t('fields.person')}</option>
          <option value="organization">{t('fields.organization')}</option>
        </Select>
        <Select
          aria-label={t('filterRole')}
          value={roleFilter}
          onChange={(e) => {
            const val = e.target.value;
            applyFilters({ role: val });
          }}
          className="w-auto"
        >
          <option value="">{t('allRoles')}</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(t, r)}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="show-archived"
            checked={showArchived}
            onCheckedChange={(checked) => {
              applyFilters({ archived: checked });
            }}
          />
          <Label htmlFor="show-archived" className="text-[13px] text-ink-2 cursor-pointer">
            {t('includeArchived')}
          </Label>
        </div>
      </div>

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
      </div>
    </div>
  );
}
