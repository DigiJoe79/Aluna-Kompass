'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Button } from '@/components/ui/button';
import { useFileDownload } from '@/lib/use-file-download';

/**
 * „Als PDF“ für Liste und Maske (Spec 2026-10-05, § 9). Die Ablehnung steht
 * über dem Knopf (MUSTER A), wie im Backup-Export. Beim ersten Export rechnet
 * der Server die Druckbilder, das kann dauern; der Knopf sagt es.
 */
export function ProfileExportButton({ ids, size }: { ids: readonly string[]; size?: 'sm' }) {
  const t = useTranslations('animals.print');
  const { busy, refusal, download } = useFileDownload({ forbidden: t('refused.forbidden'), notFound: t('refused.notFound'), failed: t('refused.failed') });
  return (
    <div className="flex flex-col items-end gap-1">
      <RefusalNotice action state={refusal} />
      <Button variant="outline" size={size} disabled={busy} aria-busy={busy} data-testid="animals-export" onClick={() => void download(`/animals/export?ids=${ids.join(',')}`, 'profile.pdf')}>
        <Download className="size-4" aria-hidden />
        {busy ? t('running') : t('export')}
      </Button>
    </div>
  );
}
