'use server';

import { createContact } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/** Leere Formularfelder sollen `null` werden, nicht der leere String. */
const orNull = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

export async function createContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const kind = String(formData.get('kind') ?? 'person');
  const shared = {
    addressExtra: orNull(formData.get('addressExtra')),
    street: orNull(formData.get('street')),
    postalCode: orNull(formData.get('postalCode')),
    city: orNull(formData.get('city')),
    country: orNull(formData.get('country')),
    notes: orNull(formData.get('notes')),
  };
  const input =
    kind === 'organization'
      ? { kind: 'organization' as const, name: String(formData.get('name') ?? ''), legalForm: orNull(formData.get('legalForm')), ...shared }
      : {
          kind: 'person' as const,
          salutation: orNull(formData.get('salutation')),
          firstName: orNull(formData.get('firstName')),
          lastName: String(formData.get('lastName') ?? ''),
          ...shared,
        };
  const result = await createContact(deps, ctx, input);
  revalidatePath('/contacts');
  return toActionState(result, t, t('contacts.toast.created'));
}
