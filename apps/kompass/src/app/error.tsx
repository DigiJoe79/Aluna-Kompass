'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * Die Fehlergrenze für alles ausserhalb der Anwendung: Anmeldung,
 * Passwortwechsel, Ersteinrichtung. Sie trägt bewusst die Karte dieser Seiten
 * und nicht den Rahmen der Anwendung — wer hier steht, ist noch nicht drin.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors.pages.technical');
  const brand = useTranslations('app');

  return (
    <AuthCard brand={brand('name')} title={t('title')}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="rounded-sm bg-error-bg px-1.5 py-0.5 font-mono font-semibold text-error">500</span>
        <span className="text-muted-ink">{t('kicker')}</span>
      </div>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('text')}</p>
      {error.digest ? (
        <code className="w-fit rounded-md bg-code px-2 py-1 font-mono text-[12px]">{error.digest}</code>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={reset}>{t('retry')}</Button>
        <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
          {t('login')}
        </Link>
      </div>
    </AuthCard>
  );
}
