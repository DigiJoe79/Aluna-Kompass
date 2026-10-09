'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { checkFilter, FilterBar, selectFilter } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { useUrlFilters } from '@/lib/use-url-filters';

export interface JournalFiltersProps {
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  /** Die Geschäftsjahre für den Filter „Jahr“ (Joe 2026-10-08: sichtbar statt nur aus Links). */
  years: { id: string; label: string }[];
  /** Treffer mit allen Filtern und Buchungen ohne Filter — die Zählzeile. */
  count: { shown: number; total: number };
}

const STATES = ['draft', 'reviewed', 'final', 'reversed'] as const;
/** Was „Filter zurücksetzen“ nimmt; Sortierung ist kein Filter und bleibt. */
const FILTER_KEYS = ['q', 'state', 'account', 'year', 'category', 'novoucher', 'agent', 'ids'] as const;

/**
 * Filterleiste des Journals (Spec Filterleisten § 4): Suche, Zustand, Konto und Jahr sichtbar, Kategorie und die
 * beiden „Nur …“ unter „Weitere Filter“, `ids` aus dem Regel-Dialog als versteckter Filter mit Chip. Jeder Wechsel
 * setzt die Seite zurück.
 */
export function JournalFilters({ accounts, categories, years, count }: JournalFiltersProps) {
  const t = useTranslations('finance.journal.filters');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  // Das Suchfeld hält seinen Text selbst; die Auswahlfelder lesen die Adresse direkt.
  const [search, setSearch] = useUrlFilters({ q: params.get('q') ?? '' });

  const apply = (patch: Record<string, string | null>) => {
    if ('q' in patch) setSearch({ q: patch.q ?? '' });
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value.trim());
      else next.delete(key);
    }
    startTransition(() => router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname));
  };
  const value = (key: string) => params.get(key) ?? '';
  const ids = value('ids').split(',').filter(Boolean);

  return (
    <FilterBar
      search={<SearchField value={search.q} onChange={(q) => apply({ q })} placeholder={t('textPlaceholder')} />}
      searchActive={search.q.trim() ? { chip: search.q.trim(), onClear: () => apply({ q: null }) } : undefined}
      filters={[
        selectFilter({ key: 'state', label: t('state.label'), value: value('state'), options: STATES.map((s) => ({ value: s, label: t(`state.${s}`) })), onChange: (state) => apply({ state }) }),
        selectFilter({ key: 'account', label: t('account'), value: value('account'), options: accounts.map((a) => ({ value: a.id, label: a.name })), onChange: (account) => apply({ account }) }),
        selectFilter({ key: 'year', label: t('year'), value: value('year'), options: years.map((y) => ({ value: y.id, label: y.label })), onChange: (year) => apply({ year }) }),
      ]}
      more={[
        selectFilter({ key: 'category', label: t('category'), value: value('category'), options: categories.map((c) => ({ value: c.id, label: c.name })), onChange: (category) => apply({ category }) }),
        checkFilter({ key: 'novoucher', label: t('withoutVoucher'), value: value('novoucher') === '1', onChange: (on) => apply({ novoucher: on ? '1' : null }) }),
        checkFilter({ key: 'agent', label: t('agentPrepared'), value: value('agent') === '1', onChange: (on) => apply({ agent: on ? '1' : null }) }),
      ]}
      hidden={[
        {
          key: 'ids',
          label: t('ids'),
          active: ids.length > 0,
          onClear: () => apply({ ids: null }),
          control: null,
          sheet: { value: value('ids'), render: () => null, apply: () => undefined },
        },
      ]}
      onApply={(values) => apply(values)}
      count={{ ...count, noun: { one: t('nounOne'), other: t('nounOther'), dative: t('nounDative') } }}
      onReset={() => apply(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}
    />
  );
}
