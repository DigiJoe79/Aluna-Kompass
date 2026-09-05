import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export function ForbiddenCard({ permission }: { permission: string }) {
  const t = useTranslations('errors.pages.forbidden');
  return (
    <section className="flex min-h-[320px] max-w-[720px] flex-col gap-3 rounded-lg border border-line bg-surface p-7">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 font-mono font-semibold text-warning">403</span>
        <span className="text-muted-ink">{t('kicker')}</span>
      </div>
      <h2 className="font-heading text-[20px]">{t('title')}</h2>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('text')}</p>
      <code className="w-fit rounded-md bg-code px-2 py-1 font-mono text-[12px]">{permission}</code>
      <div className="mt-auto flex items-center gap-3">
        <Link href="/" className={buttonVariants()}>{t('home')}</Link>
        <span className="text-[12px] text-muted-ink">{t('footnote')}</span>
      </div>
    </section>
  );
}
