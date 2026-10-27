'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';

/** „Zuletzt geändert von <Name>, <Zeit>“ in der Speicherleiste einer Karte (Board 12d) — so sieht der zweite Prüfer, was der erste geändert hat. */
export function useLastChanged(names: Record<string, string>) {
  const t = useTranslations('finance.audit.report');
  const fmt = useDateFormat();
  return (userId: string | null, at: string | null) => (userId && at ? t('lastChanged', { name: names[userId] ?? '', date: fmt.dateTime(at) }) : undefined);
}
