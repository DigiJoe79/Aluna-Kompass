'use client';

import type { OrganKind } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FixedValue } from '@/components/fixed-value';
import { ActionForm } from '@/components/forms/action-form';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { saveOrganAction } from '../actions';

/** Das Organ als Formular (Stammdaten, Board 4b): Name; Art fest; beim Vorstand die Vertretung als Lesezeile mit Link. */
export function OrganForm({ organ, representation }: { organ: { id: string; kind: OrganKind; name: string } | null; representation: { value: string; href: string | null } | null }) {
  const t = useTranslations('governance.organ');
  const [state, action] = useActionState(saveOrganAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  const [baseline, setBaseline] = useState(0);
  useEffect(() => {
    if (state.status !== 'success') return;
    toast.success(state.message ?? '');
    setBaseline((n) => n + 1);
  }, [state]);
  return (
    <FormCard>
      <ActionForm action={action} state={state}>
        {organ ? <input type="hidden" name="id" value={organ.id} /> : null}
        <input type="hidden" name="kind" value={organ?.kind ?? 'other'} />
        <FormCardBody>
          <Section title={t('section')}>
            <FormGrid>
              <FormField id="organ-name" label={t('name')} required error={errors.name}>
                <Input id="organ-name" name="name" defaultValue={organ?.name ?? ''} />
              </FormField>
              {organ ? <FixedValue id="organ-kind" label={t('kind')} value={t(`kinds.${organ.kind}`)} reason={t('kindFixed')} /> : null}
              {representation ? <FixedValue id="organ-representation" label={t('representation')} value={representation.value} href={representation.href ?? undefined} reason={t('representationFixed')} size="full" /> : null}
            </FormGrid>
          </Section>
        </FormCardBody>
        <FormActionBar state={state} baseline={baseline} mode={organ ? 'edit' : 'create'} />
      </ActionForm>
    </FormCard>
  );
}
