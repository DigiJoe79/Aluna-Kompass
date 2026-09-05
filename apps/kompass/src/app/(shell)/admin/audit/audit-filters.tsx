'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';

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
  const select = 'h-8 rounded-md border border-line-strong bg-field px-2 text-[13px]';
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-4">
      <Input
        aria-label={t('text')}
        placeholder={t('text')}
        defaultValue={params.get('text') ?? ''}
        onBlur={(e) => update('text', e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') update('text', (e.target as HTMLInputElement).value);
        }}
        className="h-8 w-[200px]"
      />
      <select
        aria-label={t('user')}
        className={select}
        value={params.get('userId') ?? ''}
        onChange={(e) => update('userId', e.target.value)}
      >
        <option value="">{t('allUsers')}</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t('channel')}
        className={select}
        value={params.get('channel') ?? ''}
        onChange={(e) => update('channel', e.target.value)}
      >
        <option value="">{t('allChannels')}</option>
        <option value="ui">{t('channels.ui')}</option>
        <option value="mcp">{t('channels.mcp')}</option>
        <option value="system">{t('channels.system')}</option>
      </select>
      <select
        aria-label={t('action')}
        className={select}
        value={params.get('action') ?? ''}
        onChange={(e) => update('action', e.target.value)}
      >
        <option value="">{t('allActions')}</option>
        {actions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <Input
        aria-label={t('from')}
        type="date"
        defaultValue={params.get('from') ?? ''}
        onChange={(e) => update('from', e.target.value)}
        className="h-8 w-[150px] font-mono"
      />
      <Input
        aria-label={t('to')}
        type="date"
        defaultValue={params.get('to') ?? ''}
        onChange={(e) => update('to', e.target.value)}
        className="h-8 w-[150px] font-mono"
      />
      <span className="ml-auto text-[13px] text-muted-ink">{t('count', { count: total })}</span>
    </div>
  );
}
