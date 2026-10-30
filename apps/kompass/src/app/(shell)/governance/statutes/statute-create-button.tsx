'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { createStatuteDraftAction } from './actions';

/** „Stand anlegen“: ohne `basedOnId` wählt der Dienst die Basis (gültiger oder jüngerer beschlossener Stand, W-1) und öffnet den Entwurf zum Bearbeiten. */
export function StatuteCreateButton({ basedOnId }: { basedOnId: string | null }) {
  const t = useTranslations('governance.statutes');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const create = async () => {
    setPending(true);
    const result = await feedback.run(() => createStatuteDraftAction(basedOnId), { retry: () => void create() });
    setPending(false);
    if (result.status === 'success') router.push(`/governance/statutes/${(result.data as { id: string }).id}/edit`);
  };
  return (
    <span className="inline-flex flex-col items-end gap-2">
      {feedback.state.status === 'error' ? <RefusalNotice state={feedback.state} /> : null}
      <Button type="button" onClick={() => void create()} disabled={pending} data-testid="statute-create">{t('create')}</Button>
    </span>
  );
}
