import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { HydrationMarker } from '@/components/hydration-marker';
import { buttonVariants } from '@/components/ui/button';

export function ForbiddenCard({ permission }: { permission: string }) {
  const t = useTranslations('errors.pages.forbidden');
  return (
    <section className="flex min-h-[320px] flex-col gap-3 rounded-lg border border-line bg-surface p-7">
      <div className="flex items-center gap-2 text-hint">
        <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 font-mono font-semibold text-warning">403</span>
        <span className="text-muted-ink">{t('kicker')}</span>
      </div>
      <h1 className="font-heading text-page-title">{t('title')}</h1>
      <p className="text-body text-ink-2">{t('text')}</p>
      <code className="w-fit rounded-md bg-code px-2 py-1 font-mono text-hint">{permission}</code>
      <div className="mt-auto flex items-center gap-3">
        <Link href="/" className={buttonVariants()}>{t('home')}</Link>
        <span className="text-hint text-muted-ink">{t('footnote')}</span>
      </div>
      <HydrationMarker />
    </section>
  );
}
