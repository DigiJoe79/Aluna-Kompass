'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';

/** Zieht den Protokollauszug als Download — kein Akteneintrag, deshalb ein Link statt einer Aktion. */
export function ExportButton({ enabled }: { enabled: boolean }) {
  const t = useTranslations('audit');
  const params = new URLSearchParams(useSearchParams().toString());
  params.delete('entry');
  params.delete('offset');
  const query = params.toString();

  if (!enabled) {
    return (
      <Button variant="secondary" disabled>
        <Download className="size-4" aria-hidden />
        {t('export')}
      </Button>
    );
  }
  return (
    <a href={`/admin/audit/export${query ? `?${query}` : ''}`} className={buttonVariants({ variant: 'secondary' })}>
      <Download className="size-4" aria-hidden />
      {t('export')}
    </a>
  );
}
