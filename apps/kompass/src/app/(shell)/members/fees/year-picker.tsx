'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { FilterBar, frameFilter } from '@/components/filter-bar';

/** Nur das Jahr, wenn es noch keine Beiträge hat (4c): dieselbe Filterleiste, ohne Suche und Filter. */
export function FeesYearPicker({ year, years }: { year: number; years: number[] }) {
  const t = useTranslations('members.fees');
  const router = useRouter();
  const go = (value: string) => router.replace(`/members/fees?year=${value}`);
  return (
    <FilterBar
      filters={[frameFilter({ key: 'year', label: t('year'), value: String(year), options: years.map((y) => ({ value: String(y), label: String(y) })), onChange: go })]}
      onApply={(values) => go(values.year ?? String(year))}
      count={{ shown: 0, total: 0, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
      onReset={() => undefined}
    />
  );
}
