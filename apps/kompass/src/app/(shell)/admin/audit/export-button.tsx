'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportAuditPdfAction } from './actions';

export function ExportButton({ enabled }: { enabled: boolean }) {
  const t = useTranslations('audit');
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={!enabled || pending} onClick={() => start(async () => { const s = await exportAuditPdfAction(Object.fromEntries(params.entries())); if (s.status === 'error') toast.error(s.message); })}>
      <Download className="size-4" aria-hidden />{pending ? t('exporting') : t('export')}
    </Button>
  );
}
