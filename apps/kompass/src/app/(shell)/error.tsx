'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Page } from '@/components/page';
import { Button, buttonVariants } from '@/components/ui/button';

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.pages.technical');
  return (
    <Page width="task">
      <section className="flex min-h-[320px] flex-col gap-3 rounded-lg border border-error bg-surface p-7">
        <div className="flex items-center gap-2 text-hint">
          <span className="rounded-sm bg-error-bg px-1.5 py-0.5 font-mono font-semibold text-error">500</span>
          <span className="text-muted-ink">{t('kicker')}</span>
        </div>
        <h1 className="font-heading text-page-title">{t('title')}</h1>
        <p className="text-body text-ink-2">{t('text')}</p>
        {error.digest ? <code className="w-fit rounded-md bg-code px-2 py-1 font-mono text-hint">{error.digest}</code> : null}
        <div className="mt-auto flex gap-2">
          <Button onClick={reset}>{t('retry')}</Button>
          <Link href="/" className={buttonVariants({ variant: 'secondary' })}>{t('home')}</Link>
        </div>
      </section>
    </Page>
  );
}
