'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export interface JournalFiltersProps {
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}

const STATES = ['draft', 'reviewed', 'final', 'reversed'] as const;

/** Filterleiste in der Grammatik von `dms/document-list.tsx`: GET-Formular, Sortierung überlebt jeden Wechsel. */
export function JournalFilters({ accounts, categories }: JournalFiltersProps) {
  const t = useTranslations('finance.journal.filters');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const apply = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    startTransition(() => router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname));
  };

  const chips: { key: string; label: string }[] = [];
  if (params.get('state')) chips.push({ key: 'state', label: t(`state.${params.get('state')}`) });
  if (params.get('account')) chips.push({ key: 'account', label: accounts.find((a) => a.id === params.get('account'))?.name ?? '' });
  if (params.get('category')) chips.push({ key: 'category', label: categories.find((c) => c.id === params.get('category'))?.name ?? '' });
  if (params.get('q')) chips.push({ key: 'q', label: params.get('q')! });
  if (params.get('novoucher') === '1') chips.push({ key: 'novoucher', label: t('withoutVoucher') });
  if (params.get('agent') === '1') chips.push({ key: 'agent', label: t('agentPrepared') });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t('textLabel')}
          placeholder={t('textPlaceholder')}
          defaultValue={params.get('q') ?? ''}
          onChange={(e) => apply({ q: e.target.value })}
          className="w-[220px]"
        />
        <Select aria-label={t('state.label')} value={params.get('state') ?? ''} onChange={(e) => apply({ state: e.target.value || null })} className="w-auto">
          <option value="">{t('state.all')}</option>
          {STATES.map((state) => (
            <option key={state} value={state}>{t(`state.${state}`)}</option>
          ))}
        </Select>
        <Select aria-label={t('account')} value={params.get('account') ?? ''} onChange={(e) => apply({ account: e.target.value || null })} className="w-auto">
          <option value="">{t('accountAll')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
        <Select aria-label={t('category')} value={params.get('category') ?? ''} onChange={(e) => apply({ category: e.target.value || null })} className="w-auto">
          <option value="">{t('categoryAll')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={params.get('novoucher') === '1'} onChange={(e) => apply({ novoucher: e.target.checked ? '1' : null })} />
          {t('withoutVoucher')}
        </label>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={params.get('agent') === '1'} onChange={(e) => apply({ agent: e.target.checked ? '1' : null })} />
          {t('agentPrepared')}
        </label>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => apply({ [chip.key]: null })}
              className="inline-flex items-center gap-1 rounded-full bg-badge px-2 py-0.5 text-[12px] text-badge-ink"
            >
              {chip.label}
              <X className="size-3" aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
