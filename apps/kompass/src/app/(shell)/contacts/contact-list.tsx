'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

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

export function ContactList({ contacts }: { contacts: ContactListItem[] }) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState(params.get('text') ?? '');
  const [kindFilter, setKindFilter] = useState(params.get('kind') ?? '');
  const [showArchived, setShowArchived] = useState(params.get('archived') === '1');

  const updateUrl = (k: string, val: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (val) next.set(k, val);
    else next.delete(k);
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`);
    });
  };

  const rows = useMemo(() => {
    return contacts.filter((c) => {
      if (!showArchived && c.status === 'archived') return false;
      if (kindFilter && kindFilter !== 'all' && c.kind !== kindFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesAffiliation = c.affiliation?.toLowerCase().includes(q) ?? false;
        const matchesCity = c.city.toLowerCase().includes(q);
        const matchesChannel = c.primaryChannel.toLowerCase().includes(q);
        const matchesRole = c.roles.some((r) => r.toLowerCase().includes(q));
        if (!matchesName && !matchesAffiliation && !matchesCity && !matchesChannel && !matchesRole) return false;
      }
      return true;
    });
  }, [contacts, showArchived, kindFilter, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t('search')}
          placeholder={t('search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            updateUrl('text', e.target.value.trim() || null);
          }}
          className="h-[34px] w-[260px]"
        />
        <select
          aria-label={t('fields.kind')}
          value={kindFilter}
          onChange={(e) => {
            const val = e.target.value;
            setKindFilter(val);
            updateUrl('kind', val && val !== 'all' ? val : null);
          }}
          className="h-[34px] rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
        >
          <option value="">{t('allKinds')}</option>
          <option value="person">{t('fields.person')}</option>
          <option value="organization">{t('fields.organization')}</option>
        </select>
        <div className="flex items-center gap-2">
          <Switch
            id="show-archived"
            checked={showArchived}
            onCheckedChange={(checked) => {
              setShowArchived(checked);
              updateUrl('archived', checked ? '1' : null);
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
            {rows.map((c, i) => (
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
