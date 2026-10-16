import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';

/**
 * Sperre „Modul inaktiv“, wenn ein Modul ausgeschaltet ist — Muster
 * `(shell)/animals/layout.tsx`. `namespace` zeigt auf einen Block mit
 * `moduleInactiveTitle`, `moduleInactiveText`, `openModules`. Darstellung: die Zustandskarte (`EmptyState state`,
 * Designer Stufe 2 Nr. 13).
 */
export async function ModuleInactiveCard({ namespace }: { namespace: string }) {
  const t = await getTranslations(namespace);
  const pages = await getTranslations('errors.pages.moduleInactive');
  return (
    <EmptyState
      state={{
        mark: <StatusBadge tone="neutral">{pages('kicker')}</StatusBadge>,
        title: t('moduleInactiveTitle'),
        text: t('moduleInactiveText'),
        primary: (
          <Link href="/admin/modules" className={buttonVariants()}>
            {t('openModules')}
          </Link>
        ),
      }}
    />
  );
}
