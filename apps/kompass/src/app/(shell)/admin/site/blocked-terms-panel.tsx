'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/forms/action-form';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveBlockedTermsAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

/**
 * Die Sperrwörter (Backlog 23): ein Begriff je Zeile. Die Seite verlangt
 * `site.manage`, das Speichern aber `site.publish` (Dienst `setBlockedTerms`);
 * ohne dieses Recht ist die Liste nur zu lesen.
 */
export function BlockedTermsPanel({ terms, canPublish }: { terms: string[]; canPublish: boolean }) {
  const t = useTranslations('site.publish.blockedTerms');
  const tAdmin = useTranslations('site.admin');
  const [state, action] = useActionState(saveBlockedTermsAction, idleState);
  const [saves, setSaves] = useState(0);
  const titleId = useId();

  useEffect(() => {
    if (state.status !== 'success') return;
    toast.success(state.message ?? '');
    // Die Maske bleibt stehen: Die Leiste zählt ab dem gespeicherten Stand neu.
    setSaves((n) => n + 1);
  }, [state]);

  // Eine Karte, die Leiste ihr letztes Kind (MUSTER § B/E).
  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-lg border border-line bg-surface">
      <ActionForm action={action} state={state}>
        <div className="flex flex-col gap-3 p-5">
          <h3 id={titleId} className="text-[15px] font-semibold">{t('title')}</h3>
          <p className="max-w-prose text-[13px] text-ink-2">{t('intro')}</p>
          <FormGrid>
            <FormField id="blocked-terms" label={t('label')} hint={t('hint')} size="l">
              <Textarea id="blocked-terms" name="terms" rows={4} readOnly={!canPublish} defaultValue={terms.join('\n')} className="font-mono text-[13px]" />
            </FormField>
          </FormGrid>
          {canPublish ? null : (
            <p className="text-[13px] text-ink-2" role="note">{tAdmin('needsPublish')}</p>
          )}
        </div>
        {canPublish ? <FormActionBar baseline={saves} saveLabel={t('save')} state={withUnplacedFieldErrors(state, [])} /> : null}
      </ActionForm>
    </section>
  );
}
