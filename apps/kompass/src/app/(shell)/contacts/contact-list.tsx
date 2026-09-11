'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
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
  const [query, setQuery] = useState(params.get('text') ?? '');
  const [kindFilter, setKindFilter] = useState(params.get('kind') ?? '');
  const [roleFilter, setRoleFilter] = useState(params.get('role') ?? '');
  const [showArchived, setShowArchived] = useState(params.get('archived') === '1');

  // Aus allen vier Feldern zusammen, nicht als Patch auf `params` — sonst geht
  // eine Änderung verloren, wenn zwei Filter im selben Render umgestellt werden.
  const applyFilters = (patch: Partial<{ text: string; kind: string; role: string; archived: boolean }>) => {
    const merged = { text: query, kind: kindFilter, role: roleFilter, archived: showArchived, ...patch };
    const next = new URLSearchParams();
    if (merged.text.trim()) next.set('text', merged.text.trim());
    if (merged.kind) next.set('kind', merged.kind);
    if (merged.role) next.set('role', merged.role);
    if (merged.archived) next.set('archived', '1');
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
            setQuery(e.target.value);
            applyFilters({ text: e.target.value });
          }}
          className="w-[260px]"
        />
        <Select
          aria-label={t('fields.kind')}
          value={kindFilter}
          onChange={(e) => {
            const val = e.target.value;
            setKindFilter(val);
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
            setRoleFilter(val);
            applyFilters({ role: val });
          }}
          className="w-auto"
        >
          <option value="">{t('allRoles')}</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="show-archived"
            checked={showArchived}
            onCheckedChange={(checked) => {
              setShowArchived(checked);
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
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('columns.name')}</TableHead>
              <TableHead className="px-4">{t('columns.kind')}</TableHead>
              <TableHead className="px-4">{t('columns.roles')}</TableHead>
              <TableHead className="px-4">{t('columns.city')}</TableHead>
              <TableHead className="px-4">{t('columns.contact')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c, i) => (
              <TableRow
                key={c.id}
                onClick={() => router.push(`/contacts/${c.id}`)}
                className={cn(
                  'h-[52px] cursor-pointer border-b border-line-2 hover:bg-row-hover',
                  i % 2 === 1 && 'bg-zebra',
                )}
              >
                <TableCell className="px-4">
                  <div className="flex flex-col">
                    <Link
                      href={`/contacts/${c.id}`}
                      className="font-semibold underline underline-offset-2 hover:text-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.name}
                    </Link>
                    {c.affiliation ? (
                      <span className="text-[12px] text-muted-ink">{c.affiliation}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="px-4 text-ink-2">
                  {c.kind === 'organization' ? t('fields.organization') : t('fields.person')}
                  {c.status === 'archived' ? (
                    <StatusBadge tone="neutral" className="ml-2">
                      {t('archived')}
                    </StatusBadge>
                  ) : null}
                </TableCell>
                <TableCell className="px-4">
                  <div className="flex flex-wrap gap-1">
                    {c.roles.map((r) => (
                      <StatusBadge key={r} tone="info">
                        {r}
                      </StatusBadge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="px-4 text-ink-2">{c.city || '—'}</TableCell>
                <TableCell className="px-4 text-ink-2 font-mono text-[13px]">{c.primaryChannel || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
