'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { FilterBar, frameFilter } from '@/components/filter-bar';

/**
 * Das Jahr des Jahresabschlusses als Rahmen (MUSTER § L): grenzt ab, ist kein gesetzter Filter; am Telefon steht es
 * offen da (ein einzelner Filter). Ohne Zählzeile: „12 von 12 erledigt“ im Kopf nennt die Schritte schon (Designer Runde 7, 294).
 */
export function ClosingYearBar({ years, yearId }: { years: { id: string; designation: string }[]; yearId: string; steps?: number }) {
  const t = useTranslations('finance.closing');
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const go = (value: string) => startNavigation(() => router.replace(`/finance/closing?year=${encodeURIComponent(value)}`));
  return (
    <FilterBar
      filters={[frameFilter({ key: 'year', label: t('yearChoice'), value: yearId, options: years.map((y) => ({ value: y.id, label: y.designation })), onChange: go })]}
      onApply={(values) => (values.year ? go(values.year) : undefined)}
      onReset={() => undefined}
      testId="closing-year"
    />
  );
}
