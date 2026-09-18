'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.pages.technical');
  return (
    <section className="flex min-h-[320px] max-w-[720px] flex-col gap-3 rounded-lg border border-error bg-surface p-7">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="rounded-sm bg-error-bg px-1.5 py-0.5 font-mono font-semibold text-error">500</span>
        <span className="text-muted-ink">{t('kicker')}</span>
      </div>
      <h2 className="font-heading text-[20px]">{t('title')}</h2>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('text')}</p>
      {error.digest ? <code className="w-fit rounded-md bg-code px-2 py-1 font-mono text-[12px]">{error.digest}</code> : null}
      <div className="mt-auto flex gap-2">
        <Button onClick={reset}>{t('retry')}</Button>
        <Link href="/" className={buttonVariants({ variant: 'secondary' })}>{t('home')}</Link>
      </div>
    </section>
  );
}
