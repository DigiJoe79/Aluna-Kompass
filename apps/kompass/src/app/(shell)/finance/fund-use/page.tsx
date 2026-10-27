import { hasPermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';

/**
 * Mittelverwendung (Board 1c, N1, Freigabe Joe 2026-10-24): Die Rechnung kommt in einer späteren Fassung; bis dahin
 * sagt eine Zustandskarte, was kommt, und verweist auf Zweckmittel und Rücklagenspiegel. Ohne eigenen `PageHeader`:
 * Die Karte trägt das `h1` der Seite (MUSTER § Seitenrahmen, Wächter `one-h1`).
 */
export default async function FundUsePage() {
  const { ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.overview')) return <Page width="task"><ForbiddenCard permission="finance.overview" /></Page>;
  const t = await getTranslations('finance.fundUse');
  const tMuted = await getTranslations('common.muted');
  // Der Rücklagenspiegel („Zurückgelegtes Geld“) braucht finance.read; ohne steht das Wort ohne Link.
  const canReadReserves = hasPermission(ctx, 'finance.read');
  return (
    <Page width="task">
      <EmptyState
        state={{
          mark: <StatusBadge tone="neutral">{tMuted('later')}</StatusBadge>,
          title: t('title'),
          text: t('text'),
          detail: (
            <p className="max-w-prose text-meta text-muted-ink">
              {t.rich('detail', {
                purposes: (chunks) => <Link href="/finance/purposes" className="text-link underline">{chunks}</Link>,
                reserves: (chunks) => (canReadReserves ? <Link href="/finance/reserves" className="text-link underline">{chunks}</Link> : chunks),
              })}
            </p>
          ),
          primary: (
            <Link href="/finance/reports" className={buttonVariants()}>
              {t('toReports')}
            </Link>
          ),
        }}
      />
    </Page>
  );
}
