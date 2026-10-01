'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useUrlFilters } from '@/lib/use-url-filters';

export function AuditFilters({
  users,
  actions,
  total,
}: {
  users: { id: string; name: string }[];
  actions: string[];
  total: number;
}) {
  const t = useTranslations('audit.filters');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('entry');
    next.delete('offset');
    router.replace(`${pathname}?${next.toString()}`);
  };
  // Such- und Datumsfelder brauchen eigenen Zustand und folgen der Adresse, wenn sie von außen wechselt
  // (Seitenleiste, Zurück). Die Auswahlfelder lesen die Adresse direkt.
  const [filters, setFilters] = useUrlFilters({ text: params.get('text') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '' });
  // Der Suchtext gilt erst mit Enter oder beim Verlassen des Felds; bis dahin ist er ein Entwurf.
  const [draft, setDraft] = useState(filters.text);
  useEffect(() => setDraft(filters.text), [filters.text]);
  const commitText = (value: string) => {
    if (value === filters.text) return;
    setFilters({ ...filters, text: value });
    update('text', value);
  };
  const changeDate = (key: 'from' | 'to', value: string) => {
    setFilters({ ...filters, [key]: value });
    update(key, value);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-4">
      <Input
        aria-label={t('text')}
        placeholder={t('text')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commitText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitText((e.target as HTMLInputElement).value);
        }}
        className="w-[200px]"
      />
      <Select
        aria-label={t('user')}
        className="w-auto"
        value={params.get('userId') ?? ''}
        onChange={(e) => update('userId', e.target.value)}
      >
        <option value="">{t('allUsers')}</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('channel')}
        className="w-auto"
        value={params.get('channel') ?? ''}
        onChange={(e) => update('channel', e.target.value)}
      >
        <option value="">{t('allChannels')}</option>
        <option value="ui">{t('channels.ui')}</option>
        <option value="mcp">{t('channels.mcp')}</option>
        <option value="system">{t('channels.system')}</option>
      </Select>
      <Select
        aria-label={t('action')}
        className="w-auto"
        value={params.get('action') ?? ''}
        onChange={(e) => update('action', e.target.value)}
      >
        <option value="">{t('allActions')}</option>
        {actions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </Select>
      <Input
        aria-label={t('from')}
        type="date"
        value={filters.from}
        onChange={(e) => changeDate('from', e.target.value)}
        className="w-[150px] font-mono"
      />
      <Input
        aria-label={t('to')}
        type="date"
        value={filters.to}
        onChange={(e) => changeDate('to', e.target.value)}
        className="w-[150px] font-mono"
      />
      <span className="ml-auto text-[13px] text-muted-ink">{t('count', { count: total })}</span>
    </div>
  );
}
