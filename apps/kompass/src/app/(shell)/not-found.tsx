import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';

/** Ein Eintrag fehlt (gelöscht oder nie da): die Zustandskarte (Designer Stufe 2 Nr. 13). Unbekannte Adressen: `[...catchAll]/not-found.tsx`. */
export default async function NotFound() {
  const t = await getTranslations('errors.pages.notFound');
  return (
    <Page width="task">
      <EmptyState
        state={{
          mark: <StatusBadge tone="neutral">{t('kicker')}</StatusBadge>,
          title: t('title'),
          text: t('text'),
          primary: (
            <Link href="/" className={buttonVariants()}>
              {t('home')}
            </Link>
          ),
          secondary: (
            <Link href="/admin/audit" className={buttonVariants({ variant: 'outline' })}>
              {t('audit')}
            </Link>
          ),
        }}
      />
    </Page>
  );
}
