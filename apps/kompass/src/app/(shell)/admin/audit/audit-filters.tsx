'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDateFormat } from '@/components/date-format-provider';
import { FilterBar, filterControlClass, selectFilter, type FilterSlot } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { Input } from '@/components/ui/input';
import { useUrlFilters } from '@/lib/use-url-filters';

/** Was „Filter zurücksetzen“ nimmt; mit jedem Filterwechsel gehen auch Seite und gewählter Eintrag. */
const FILTER_KEYS = ['text', 'userId', 'action', 'from', 'to', 'channel'] as const;

/** Von und Bis als ein Filter „Zeitraum“ (Spec Filterleisten § 4); im Telefon-Sheet als „von|bis“ im Entwurf. */
function PeriodFields({ from, to, onChange, idPrefix }: { from: string; to: string; onChange: (from: string, to: string) => void; idPrefix: string }) {
  const t = useTranslations('audit.filters');
  return (
    <div role="group" aria-label={t('period')} className="flex items-center gap-1.5">
      <Input id={`${idPrefix}-from`} aria-label={t('from')} type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className={`w-[150px] font-mono ${filterControlClass(from !== '')}`} />
      <span aria-hidden className="text-muted-ink">
        –
      </span>
      <Input id={`${idPrefix}-to`} aria-label={t('to')} type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className={`w-[150px] font-mono ${filterControlClass(to !== '')}`} />
    </div>
  );
}

/**
 * Filterleiste des Protokolls (Spec Filterleisten § 4): Suche (gilt nach kurzer Pause), Nutzer, Aktion in Worten,
 * Zeitraum; Kanal unter „Weitere Filter“. Die Auswahlfelder lesen die Adresse direkt.
 */
export function AuditFilters({
  users,
  actions,
  count,
}: {
  users: { id: string; name: string }[];
  /** Alle vorkommenden Aktionen mit Klartext, sortiert. */
  actions: { value: string; label: string }[];
  count: { shown: number; total: number };
}) {
  const t = useTranslations('audit.filters');
  const fmt = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Such- und Datumsfelder folgen der Adresse, wenn sie von außen wechselt (Seitenleiste, Zurück).
  const [filters, setFilters] = useUrlFilters({ text: params.get('text') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '' });

  const update = (patch: Record<string, string>) => {
    if ('text' in patch || 'from' in patch || 'to' in patch) setFilters({ ...filters, ...patch });
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value.trim()) next.set(key, value.trim());
      else next.delete(key);
    }
    next.delete('entry');
    next.delete('offset');
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  };
  const value = (key: string) => params.get(key) ?? '';

  const periodChip = filters.from && filters.to ? t('periodBoth', { from: fmt.date(filters.from), to: fmt.date(filters.to) }) : filters.from ? t('periodFrom', { from: fmt.date(filters.from) }) : t('periodTo', { to: fmt.date(filters.to) });
  const period: FilterSlot = {
    key: 'period',
    label: t('period'),
    active: Boolean(filters.from || filters.to),
    chip: periodChip,
    onClear: () => update({ from: '', to: '' }),
    control: <PeriodFields idPrefix="audit" from={filters.from} to={filters.to} onChange={(from, to) => update({ from, to })} />,
    sheet: {
      value: `${filters.from}|${filters.to}`,
      render: (draft, onChange) => {
        const [from = '', to = ''] = draft.split('|');
        return <PeriodFields idPrefix="audit-sheet" from={from} to={to} onChange={(f, tt) => onChange(`${f}|${tt}`)} />;
      },
      apply: (draft) => {
        const [from = '', to = ''] = draft.split('|');
        update({ from, to });
      },
    },
  };

  return (
    <FilterBar
      search={<SearchField value={filters.text} onChange={(text) => update({ text })} placeholder={t('searchPlaceholder')} />}
      searchActive={filters.text.trim() ? { chip: filters.text.trim(), onClear: () => update({ text: '' }) } : undefined}
      filters={[
        selectFilter({ key: 'userId', label: t('user'), value: value('userId'), options: users.map((u) => ({ value: u.id, label: u.name })), onChange: (userId) => update({ userId }) }),
        selectFilter({ key: 'action', label: t('action'), value: value('action'), options: actions, onChange: (action) => update({ action }) }),
        period,
      ]}
      more={[
        selectFilter({
          key: 'channel',
          label: t('channel'),
          value: value('channel'),
          options: (['ui', 'mcp', 'system'] as const).map((c) => ({ value: c, label: t(`channels.${c}`) })),
          onChange: (channel) => update({ channel }),
        }),
      ]}
      onApply={(values) => {
        const { period: draft, ...rest } = values;
        const [from = '', to = ''] = draft === undefined ? [filters.from, filters.to] : draft.split('|');
        update({ ...rest, ...(draft === undefined ? {} : { from, to }) });
      }}
      count={{ ...count, noun: { one: t('nounOne'), other: t('nounOther'), dative: t('nounDative') } }}
      onReset={() => update(Object.fromEntries(FILTER_KEYS.map((key) => [key, ''])))}
    />
  );
}
