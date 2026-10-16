import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { HydrationMarker } from '@/components/hydration-marker';
import { KeyLine } from '@/components/key-line';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { nameOrEmpty } from '@/lib/name-or-empty';

/**
 * Fehlendes Recht (MUSTER § Seitenrahmen): die Zustandskarte (`EmptyState state`, Designer Stufe 2 Nr. 13). Das Recht
 * steht im Klartext im Satz, der Schlüssel klein darunter — ein Satz statt zweier, die dasselbe sagten (01 B15).
 */
export function ForbiddenCard({ permission }: { permission: string }) {
  const t = useTranslations('errors.pages.forbidden');
  const root = useTranslations();
  const labelKey = `permissions.keys.${permission}.label`;
  const label = nameOrEmpty(root.has(labelKey) ? root(labelKey) : null, permission);
  return (
    <>
      <EmptyState
        state={{
          mark: <StatusBadge tone="warning">{t('kicker')}</StatusBadge>,
          title: t('title'),
          text: t('text', { permission: label }),
          detail: <KeyLine>{permission}</KeyLine>,
          primary: (
            <Link href="/" className={buttonVariants()}>
              {t('home')}
            </Link>
          ),
        }}
      />
      <HydrationMarker />
    </>
  );
}
