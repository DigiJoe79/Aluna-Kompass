import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';

/**
 * Eine Adresse, die es nicht gibt (01 A3): eigener Text, denn „Diesen Eintrag gibt es nicht mehr“ stimmt nur für
 * einen fehlenden Datensatz. `[...catchAll]/page.tsx` ruft `notFound()`, dieser Rand fängt es im selben Segment.
 */
export default async function RouteNotFound() {
  const t = await getTranslations('errors.pages.routeNotFound');
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
        }}
      />
    </Page>
  );
}
