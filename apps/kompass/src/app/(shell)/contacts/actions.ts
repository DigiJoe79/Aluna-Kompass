'use server';

import { guardAction } from '@/lib/action-guard';
import { addContactRole, createContact, deleteContact, displayName, endContactRole, setContactChannels, updateContact } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { linkContactIban, unlinkContactIban } from '@kompass/module-finance';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/** Leere Formularfelder sollen `null` werden, nicht der leere String. */
const orNull = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

/** Zustellweg für Briefe (Handoff 2b E1); fehlt das Feld, bleibt er, wie er ist. */
const delivery = (formData: FormData): { deliveryPreference?: 'auto' | 'post' } => {
  const value = formData.get('deliveryPreference');
  return value === 'auto' || value === 'post' ? { deliveryPreference: value } : {};
};

export async function createContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/contacts/actions.ts#createContactAction', async () => {
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
      ...delivery(formData),
    };
    const input =
      kind === 'organization'
        ? { kind: 'organization' as const, name: String(formData.get('name') ?? ''), legalForm: orNull(formData.get('legalForm')), ...shared }
        : {
            kind: 'person' as const,
            salutation: orNull(formData.get('salutation')),
            firstName: orNull(formData.get('firstName')),
            lastName: String(formData.get('lastName') ?? ''),
            belongsToId: orNull(formData.get('belongsToId')),
            ...shared,
          };
    const result = await createContact(deps, ctx, input);
    revalidatePath('/contacts');
    const state = toActionState(result, t, t('contacts.toast.created'));
    // Das Suchfeld übernimmt den neuen Kontakt sofort; dafür braucht es seinen
    // Anzeigenamen, nicht den ganzen Datensatz.
    return result.ok && state.status === 'success'
      ? { ...state, data: { id: result.value.id, name: displayName(result.value) } }
      : state;
  });
}

/**
 * Bearbeiten über dieselbe Maske wie beim Anlegen. Die Art bleibt, wie sie ist;
 * `expectedVersion` ist der Stand, mit dem die Maske geladen wurde — hat ihn
 * jemand inzwischen geändert, lehnt der Dienst mit `staleVersion` ab.
 */
export async function updateContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/contacts/actions.ts#updateContactAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const id = String(formData.get('id') ?? '');
    const kind = String(formData.get('kind') ?? 'person');
    const shared = {
      addressExtra: orNull(formData.get('addressExtra')),
      street: orNull(formData.get('street')),
      postalCode: orNull(formData.get('postalCode')),
      city: orNull(formData.get('city')),
      country: orNull(formData.get('country')),
      notes: orNull(formData.get('notes')),
      ...delivery(formData),
    };
    const names =
      kind === 'organization'
        ? { name: String(formData.get('name') ?? ''), legalForm: orNull(formData.get('legalForm')) }
        : { salutation: orNull(formData.get('salutation')), firstName: orNull(formData.get('firstName')), lastName: String(formData.get('lastName') ?? ''), belongsToId: orNull(formData.get('belongsToId')) };
    const expectedVersion = String(formData.get('expectedVersion') ?? '') || undefined;
    const result = await updateContact(deps, ctx, { id, expectedVersion, ...names, ...shared });
    revalidatePath(`/contacts/${id}`);
    revalidatePath('/contacts');
    const state = toActionState(result, t, t('contacts.toast.updated'));
    return result.ok && state.status === 'success'
      ? { ...state, data: { id: result.value.id, name: displayName(result.value), updatedAt: result.value.updatedAt } }
      : state;
  });
}

export async function addContactRoleAction(id: string, role: string, since: string): Promise<ActionState> {
  return guardAction('(shell)/contacts/actions.ts#addContactRoleAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await addContactRole(deps, ctx, { id, role, since });
    revalidatePath(`/contacts/${id}`);
    return toActionState(result, t, t('contacts.toast.roleAdded'));
  });
}

export async function endContactRoleAction(id: string, roleId: string, until: string): Promise<ActionState> {
  return guardAction('(shell)/contacts/actions.ts#endContactRoleAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await endContactRole(deps, ctx, { roleId, until });
    revalidatePath(`/contacts/${id}`);
    return toActionState(result, t, t('contacts.toast.roleEnded'));
  });
}

export async function setContactChannelsAction(
  id: string,
  channels: { kind: 'email' | 'phone' | 'mobile' | 'fax' | 'web'; value: string; label?: string | null; isPrimary?: boolean }[],
): Promise<ActionState> {
  return guardAction('(shell)/contacts/actions.ts#setContactChannelsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setContactChannels(deps, ctx, { id, channels });
    revalidatePath(`/contacts/${id}`);
    return toActionState(result, t, t('contacts.toast.channelsSaved'));
  });
}

export async function deleteContactAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/contacts/actions.ts#deleteContactAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteContact(deps, ctx, { id });
    if (!result.ok) return toActionState(result, t);
    revalidatePath('/contacts');
    redirect('/contacts');
  });
}


/** Der Weg „Mandat ansehen“ unter der Ablehnung `ibanHasMandate` (Nachtrag MCP-Test § 3). */
function withMandateRemedy(state: ActionState, failure: { ok: boolean; error?: { type: string; code?: string; params?: Record<string, string | number> } }, label: string): ActionState {
  if (state.status !== 'error' || failure.ok || failure.error?.code !== 'ibanHasMandate') return state;
  const mandateId = failure.error.params?.mandateId;
  return mandateId ? { ...state, remedies: [{ label, href: `/finance/direct-debit/mandates/${mandateId}` }] } : state;
}

/**
 * „IBAN hinzufügen“ am Kontakt (Plan U4 Task 3). Hängt die IBAN schon an jemandem, kommt `contactIbanTaken` mit den
 * Namen der Inhaber in `detail` zurück — der Dialog fragt dann nach (`mode`: Gemeinschaftskonto oder umhängen).
 */
export async function linkContactIbanAction(input: { contactId: string; iban: string; mode?: 'shared' | 'move' }): Promise<ActionState> {
  return guardAction('(shell)/contacts/actions.ts#linkContactIbanAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await linkContactIban(deps, ctx, input);
    revalidatePath(`/contacts/${input.contactId}`);
    const state = withMandateRemedy(toActionState(result, t, t('finance.contactIbans.added')), result, t('finance.contactIbans.openMandate'));
    if (!result.ok && result.error.type === 'conflict' && result.error.code === 'contactIbanTaken' && state.status === 'error') return { ...state, detail: String(result.error.params?.contact ?? '') };
    return state;
  });
}

/** „Entfernen …“ einer IBAN am Kontakt; ein gültiges Mandat über sie lehnt ab, mit „Mandat ansehen“. */
export async function unlinkContactIbanAction(input: { id: string; contactId: string }): Promise<ActionState> {
  return guardAction('(shell)/contacts/actions.ts#unlinkContactIbanAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await unlinkContactIban(deps, ctx, { id: input.id });
    revalidatePath(`/contacts/${input.contactId}`);
    return withMandateRemedy(toActionState(result, t, t('finance.contactIbans.removed')), result, t('finance.contactIbans.openMandate'));
  });
}
