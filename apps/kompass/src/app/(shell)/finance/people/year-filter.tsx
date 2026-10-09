'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { FilterBar, frameFilter } from '@/components/filter-bar';

/**
 * Die Leiste der Personenübersicht (Spec Filterleisten § 4): Jahr als Filter statt als Links. Die Übersicht gilt
 * immer einem Kalenderjahr; das Jahr grenzt den Bestand ab und gilt deshalb nicht als gesetzter Filter.
 */
export function PeopleYearFilter({ years, year, count }: { years: number[]; year: number; count: number }) {
  const t = useTranslations('finance.people');
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const go = (value: string) => startNavigation(() => router.replace(`/finance/people?year=${value}`));
  const slot = frameFilter({ key: 'year', label: t('yearChoice'), value: String(year), options: years.map((y) => ({ value: String(y), label: String(y) })), onChange: go });
  return (
    <FilterBar
      filters={[slot]}
      onApply={(values) => (values.year ? go(values.year) : undefined)}
      count={{ shown: count, total: count, noun: { one: t('nounOne'), other: t('nounOther') } }}
      onReset={() => undefined}
      testId="people-year"
    />
  );
}
