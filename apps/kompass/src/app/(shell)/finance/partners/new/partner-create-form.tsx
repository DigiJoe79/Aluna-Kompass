'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { savePartnerProfileAction } from '../actions';

const STATUSES = ['taxExemptBody', 'publicBody', 'agent', 'foreignBody'] as const;

/** Karte mit Kontakt und Status; Speichern führt auf die Detailseite des neuen Partners. */
export function PartnerCreateForm() {
  const t = useTranslations('finance.partners.list');
  const c = useTranslations('common');
  const tStatus = useTranslations('finance.partners.status');
  const router = useRouter();
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('taxExemptBody');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const create = async () => {
    setPending(true);
    const result = await feedback.run(() => savePartnerProfileAction({ contactId: contact?.id ?? '', status }), { retry: () => void create() });
    setPending(false);
    if (result.status === 'success') {
      const data = result.data as { id: string } | undefined;
      router.push(data?.id ? `/finance/partners/${data.id}` : '/finance/partners');
    }
  };

  // Eine Feldmeldung, die diese Maske nicht zeigen kann, steht ganz über der Leiste.
  const state = withUnplacedFieldErrors(feedback.state, ['contactId', 'status']);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface" data-testid="partner-create-form">
      <div className="p-5">
        <section>
          <FormGrid>
            <FormCell size="m">
              <ContactPicker id="partner-new-contact" name="contactId" label={t('create.contact')} value={contact} onChange={setContact} canCreate required />
              <FieldError id="partner-new-contact-error" message={errors.contactId} />
            </FormCell>
            <FormField id="partner-new-status" label={t('create.status')} error={errors.status}>
              <Select id="partner-new-status" value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{tStatus(s)}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
        </section>
      </div>
      <FormActionBar mode="create" back={{ href: '/finance/partners', label: c('backToList') }} state={state} onSave={() => void create()} pending={pending} saveLabel={t('create.save')} />
    </div>
  );
}
