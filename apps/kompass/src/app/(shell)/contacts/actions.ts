'use server';

import { addContactRole, createContact, deleteContact, endContactRole, setContactChannels, updateContact } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

export async function updateContactAction(id: string, changes: Record<string, string | null>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await updateContact(deps, ctx, { id, ...changes });
  revalidatePath(`/contacts/${id}`);
  return toActionState(result, t, t('contacts.toast.updated'));
}

export async function addContactRoleAction(id: string, role: string, since: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await addContactRole(deps, ctx, { id, role, since });
  revalidatePath(`/contacts/${id}`);
  return toActionState(result, t, t('contacts.toast.roleAdded'));
}

export async function endContactRoleAction(id: string, roleId: string, until: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await endContactRole(deps, ctx, { roleId, until });
  revalidatePath(`/contacts/${id}`);
  return toActionState(result, t, t('contacts.toast.roleEnded'));
}

export async function setContactChannelsAction(
  id: string,
  channels: { kind: 'email' | 'phone' | 'mobile' | 'fax' | 'web'; value: string; label?: string | null; isPrimary?: boolean }[],
): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setContactChannels(deps, ctx, { id, channels });
  revalidatePath(`/contacts/${id}`);
  return toActionState(result, t, t('contacts.toast.channelsSaved'));
}

export async function deleteContactAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteContact(deps, ctx, { id });
  if (!result.ok) return toActionState(result, t);
  revalidatePath('/contacts');
  redirect('/contacts');
}

