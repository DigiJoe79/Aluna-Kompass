import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('errors.pages.notFound');
  return (
    <section className="flex min-h-[320px] max-w-[720px] flex-col gap-3 rounded-lg border border-line bg-surface p-7">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="rounded-sm bg-badge px-1.5 py-0.5 font-mono font-semibold text-badge-ink">404</span>
        <span className="text-muted-ink">{t('kicker')}</span>
      </div>
      <h2 className="font-heading text-[20px]">{t('title')}</h2>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('text')}</p>
      <div className="mt-auto flex gap-2">
        <Link href="/" className={buttonVariants()}>{t('home')}</Link>
        <Link href="/admin/audit" className={buttonVariants({ variant: 'secondary' })}>{t('audit')}</Link>
      </div>
    </section>
  );
}
