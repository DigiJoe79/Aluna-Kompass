'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { FilterBar, frameFilter } from '@/components/filter-bar';

/**
 * Das Jahr der Kassenprüfung als Rahmen (MUSTER § L): grenzt ab, ist kein gesetzter Filter. Die Zählzeile nennt die
 * Abschnitte des Prüfpakets.
 */
export function AuditYearBar({ years, yearId, sections }: { years: { id: string; designation: string }[]; yearId: string; sections: number }) {
  const t = useTranslations('finance.audit');
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const go = (value: string) => startNavigation(() => router.replace(`/finance/audit?year=${encodeURIComponent(value)}`));
  return (
    <FilterBar
      filters={[frameFilter({ key: 'year', label: t('yearChoice'), value: yearId, options: years.map((y) => ({ value: y.id, label: y.designation })), onChange: go })]}
      onApply={(values) => (values.year ? go(values.year) : undefined)}
      count={{ shown: sections, total: sections, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
      onReset={() => undefined}
      testId="audit-year"
    />
  );
}
