import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

export const SITE_PANELS = ['template', 'connection', 'cache', 'blockedTerms'] as const;
export type SitePanel = (typeof SITE_PANELS)[number];

export function panelFromQuery(value: string | undefined): SitePanel {
  return (SITE_PANELS as readonly string[]).includes(value ?? '') ? (value as SitePanel) : 'template';
}

/** Reiter der Webseiten-Einstellungen in der URL (`?panel=`), Muster wie unter Finanzen. */
export async function SitePanelNav({ active }: { active: SitePanel }) {
  const t = await getTranslations('site.admin');
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line pb-2" aria-label={t('tabsLabel')}>
      {SITE_PANELS.map((key) => (
        <Link
          key={key}
          href={`/admin/site?panel=${key}`}
          aria-current={key === active ? 'page' : undefined}
          className={cn(
            'rounded-sm px-3 py-1.5 text-[13px] font-semibold',
            key === active ? 'bg-brand-soft text-brand-ink' : 'text-muted-ink hover:bg-surface-2',
          )}
        >
          {t(`tabs.${key}`)}
        </Link>
      ))}
    </nav>
  );
}
