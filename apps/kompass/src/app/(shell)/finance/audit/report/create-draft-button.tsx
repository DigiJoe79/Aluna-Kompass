'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { createReportDraftAction } from '../actions';

/** „Entwurf anlegen“ — ein Knopf statt Anlegen beim Öffnen: Eine Seite legt beim Lesen nichts an. */
export function CreateDraftButton({ fiscalYearId, kind }: { fiscalYearId: string; kind: 'report' | 'followUp' }) {
  const t = useTranslations('finance.audit.report');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const create = async () => {
    setPending(true);
    const result = await feedback.run(() => createReportDraftAction(fiscalYearId, kind), { retry: () => void create() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('createDone'));
    router.refresh();
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <RefusalNotice action state={feedback.state} />
      <Button type="button" disabled={pending} onClick={() => void create()} data-testid="audit-report-create">
        {t('missing.create')}
      </Button>
    </div>
  );
}
