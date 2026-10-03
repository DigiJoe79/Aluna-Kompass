'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/forms/action-form';
import { SubmitButton } from '@/components/forms/submit-button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { saveBlockedTermsAction } from './actions';

/**
 * Die Sperrwörter (Backlog 23): ein Begriff je Zeile. Die Seite verlangt
 * `site.manage`, das Speichern aber `site.publish` (Dienst `setBlockedTerms`);
 * ohne dieses Recht ist die Liste nur zu lesen.
 */
export function BlockedTermsPanel({ terms, canPublish }: { terms: string[]; canPublish: boolean }) {
  const t = useTranslations('site.publish.blockedTerms');
  const tAdmin = useTranslations('site.admin');
  const [state, action] = useActionState(saveBlockedTermsAction, idleState);
  const titleId = useId();

  useEffect(() => {
    if (state.status === 'success') toast.success(state.message ?? '');
    else if (state.status === 'error') toast.error(state.message);
  }, [state]);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <h3 id={titleId} className="font-heading text-[18px]">{t('title')}</h3>
      <p className="text-[13px] text-ink-2">{t('intro')}</p>
      <ActionForm action={action} state={state} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="blocked-terms">{t('label')}</Label>
          <Textarea id="blocked-terms" name="terms" rows={4} readOnly={!canPublish} defaultValue={terms.join('\n')} className="font-mono text-[13px]" />
          <p className="text-[12px] text-muted-ink">{t('hint')}</p>
        </div>
        {canPublish ? (
          <div>
            <SubmitButton variant="outline">{t('save')}</SubmitButton>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2" role="note">{tAdmin('needsPublish')}</p>
        )}
      </ActionForm>
    </section>
  );
}
