'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Section } from '@/components/section';
import { idleState } from '@/lib/actions';
import { createMeetingAction } from '../actions';
import { MeetingHeadFields, type MeetingHeadFieldsProps } from '../meeting-head-fields';

/** Die Karte „Sitzung anlegen“ (Plan U1 Task 4); nach Erfolg geht es zur Sitzung. */
export function MeetingCreateForm(props: Omit<MeetingHeadFieldsProps, 'meeting' | 'chair' | 'minuteTaker' | 'errors'>) {
  const t = useTranslations('governance.head');
  const c = useTranslations('common');
  const [state, action] = useActionState(createMeetingAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  return (
    <FormCard>
      <ActionForm action={action} state={state}>
        <FormCardBody>
          <Section title={t('section')}>
            <MeetingHeadFields {...props} meeting={null} chair={null} minuteTaker={null} errors={errors} />
          </Section>
        </FormCardBody>
        <FormActionBar mode="create" state={state} back={{ href: '/governance/meetings', label: c('backToList') }} saveTestId="meeting-create-save" />
      </ActionForm>
    </FormCard>
  );
}
