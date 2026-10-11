import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Page } from '@/components/page';
import { buttonVariants } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('errors.pages.notFound');
  return (
    <Page width="task">
      <section className="flex min-h-[320px] flex-col gap-3 rounded-lg border border-line bg-surface p-7">
        <div className="flex items-center gap-2 text-hint">
          <span className="rounded-sm bg-badge px-1.5 py-0.5 font-mono font-semibold text-badge-ink">404</span>
          <span className="text-muted-ink">{t('kicker')}</span>
        </div>
        <h1 className="font-heading text-page-title">{t('title')}</h1>
        <p className="text-body text-ink-2">{t('text')}</p>
        <div className="mt-auto flex gap-2">
          <Link href="/" className={buttonVariants()}>{t('home')}</Link>
          <Link href="/admin/audit" className={buttonVariants({ variant: 'secondary' })}>{t('audit')}</Link>
        </div>
      </section>
    </Page>
  );
}
