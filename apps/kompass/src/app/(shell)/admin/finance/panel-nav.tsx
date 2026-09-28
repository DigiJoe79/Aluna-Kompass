import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

export const PANEL_KEYS = ['checklist', 'accounts', 'categories', 'purposes', 'fiscalYears', 'datedValues', 'tax', 'permissions'] as const;
export type PanelKey = (typeof PANEL_KEYS)[number];

export function panelFromQuery(value: string | undefined): PanelKey {
  return (PANEL_KEYS as readonly string[]).includes(value ?? '') ? (value as PanelKey) : 'checklist';
}

/** Reiter der Einrichtung (H1–H8) in der URL (`?panel=`), Muster wie bei den offenen Zahlungen. */
export async function PanelNav({ active }: { active: PanelKey }) {
  const t = await getTranslations('finance.admin.tabs');
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line pb-2" aria-label={t('checklist')}>
      {PANEL_KEYS.map((key) => (
        <Link
          key={key}
          href={`/admin/finance?panel=${key}`}
          aria-current={key === active ? 'page' : undefined}
          className={cn(
            'rounded-sm px-3 py-1.5 text-[13px] font-semibold',
            key === active ? 'bg-brand-soft text-brand-ink' : 'text-muted-ink hover:bg-surface-2',
          )}
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
