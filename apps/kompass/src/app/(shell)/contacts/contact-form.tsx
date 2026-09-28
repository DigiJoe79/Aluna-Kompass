'use client';

import { formatPostalAddress } from '@kompass/module-contacts/address';
import { Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createContactAction, updateContactAction } from './actions';
import { Select } from '@/components/ui/select';
import { ActionForm } from '@/components/forms/action-form';

/** Was die Maske zum Bearbeiten braucht: die Felder und den Ladestand. */
export type EditableContact = {
  id: string;
  kind: 'person' | 'organization';
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  legalForm: string | null;
  addressExtra: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  updatedAt: string;
};

/** Neuere von zwei ISO-Zeitstempeln — der Stand aus der Antwort, bis der Refresh ihn nachreicht. */
const newer = (a: string, b: string | null) => (b && b > a ? b : a);

/**
 * Dasselbe Formular an drei Stellen: als eigener Knopf auf der Kontaktseite,
 * als Overlay aus dem Suchfeld heraus und — mit `contact` — zum Bearbeiten auf
 * der Kontaktseite. Wer es von außen öffnet, gibt `open`/`onOpenChange` mit und
 * bekommt über `onCreated` den neuen Kontakt zurück — ohne diese Angaben bleibt
 * alles, wie es war.
 */
export function CreateContactDialog({
  open: controlledOpen,
  onOpenChange,
  onCreated,
  withTrigger = true,
  contact,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (contact: { id: string; name: string }) => void;
  withTrigger?: boolean;
  contact?: EditableContact;
} = {}) {
  const t = useTranslations('contacts');
  const c = useTranslations('common');
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [state, action] = useActionState(contact ? updateContactAction : createContactAction, idleState);
  const [savedVersion, setSavedVersion] = useState<string | null>(null);

  const [kind, setKind] = useState<'person' | 'organization'>(contact?.kind ?? 'person');
  const [salutation, setSalutation] = useState(contact?.salutation ?? '');
  const [firstName, setFirstName] = useState(contact?.firstName ?? '');
  const [lastName, setLastName] = useState(contact?.lastName ?? '');
  const [name, setName] = useState(contact?.name ?? '');
  const [legalForm, setLegalForm] = useState(contact?.legalForm ?? '');
  const [addressExtra, setAddressExtra] = useState(contact?.addressExtra ?? '');
  const [street, setStreet] = useState(contact?.street ?? '');
  const [postalCode, setPostalCode] = useState(contact?.postalCode ?? '');
  const [city, setCity] = useState(contact?.city ?? '');
  const [country, setCountry] = useState(contact?.country ?? '');
  const [notes, setNotes] = useState(contact?.notes ?? '');

  // Beim Anlegen zurück auf leer, beim Bearbeiten zurück auf den geladenen Stand.
  const reset = () => {
    setKind(contact?.kind ?? 'person');
    setSalutation(contact?.salutation ?? '');
    setFirstName(contact?.firstName ?? '');
    setLastName(contact?.lastName ?? '');
    setName(contact?.name ?? '');
    setLegalForm(contact?.legalForm ?? '');
    setAddressExtra(contact?.addressExtra ?? '');
    setStreet(contact?.street ?? '');
    setPostalCode(contact?.postalCode ?? '');
    setCity(contact?.city ?? '');
    setCountry(contact?.country ?? '');
    setNotes(contact?.notes ?? '');
  };

  // Kommt ein neuer Stand vom Server (Refresh nach dem Speichern oder einer
  // Änderung anderswo), übernimmt die geschlossene Maske ihn.
  useEffect(() => {
    if (contact && !open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.updatedAt]);

  useEffect(() => {
    if (state.status === 'success') {
      const saved = state.data as { id: string; name: string; updatedAt?: string } | undefined;
      if (contact) {
        if (saved?.updatedAt) setSavedVersion(saved.updatedAt);
        setOpen(false);
        return;
      }
      if (saved) onCreated?.(saved);
      setOpen(false);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const mode = contact ? 'edit' : 'create';

  const preview = useMemo(() => {
    return formatPostalAddress({
      kind,
      salutation,
      firstName,
      lastName,
      name,
      legalForm,
      addressExtra,
      street,
      postalCode,
      city,
      country,
    });
  }, [kind, salutation, firstName, lastName, name, legalForm, addressExtra, street, postalCode, city, country]);

  const errors = state.status === 'error' ? state.fieldErrors : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Nach einem Speichern steht der gespeicherte Stand schon in der Maske;
        // zurückgesetzt wird nur, was nicht gespeichert wurde.
        if (!next && !(contact && state.status === 'success')) reset();
      }}
    >
      {withTrigger ? (
        <DialogTrigger
          render={
            contact ? (
              <Button variant="outline">
                <Pencil className="size-3.5" aria-hidden />
                {t('edit.trigger')}
              </Button>
            ) : (
              <Button>
                <Plus className="size-3.5" aria-hidden />
                {t('create.trigger')}
              </Button>
            )
          }
        />
      ) : null}
      <DialogContent className="w-full sm:max-w-[840px] bg-surface p-0 shadow-md">
        <ActionForm action={action} state={state}>
          <div className="p-6">
            <DialogTitle className="font-heading text-[19px]">{t(`${mode}.title`)}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t(`${mode}.description`)}</DialogDescription>
            {contact ? (
              <>
                <input type="hidden" name="id" value={contact.id} />
                <input type="hidden" name="expectedVersion" value={newer(contact.updatedAt, savedVersion)} />
                <input type="hidden" name="kind" value={contact.kind} />
              </>
            ) : null}

            {state.status === 'error' && Object.keys(errors).length === 0 ? (
              <p role="alert" className="mt-3 rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">
                {state.message}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-12">
              <div className="space-y-4 md:col-span-7">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="kind" className="text-[13px] font-semibold text-ink-2">
                    {t('fields.kind')}
                  </Label>
                  <Select
                    id="kind"
                    name={contact ? undefined : 'kind'}
                    disabled={Boolean(contact)}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as 'person' | 'organization')}
                    className="w-auto"
                  >
                    <option value="person">{t('fields.person')}</option>
                    <option value="organization">{t('fields.organization')}</option>
                  </Select>
                </div>

                {kind === 'person' ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <FormField id="salutation" label={t('fields.salutation')} error={errors.salutation}>
                        <Input
                          id="salutation"
                          name="salutation"
                          list="salutations"
                          value={salutation}
                          onChange={(e) => setSalutation(e.target.value)}
                        />
                        <datalist id="salutations">
                          <option value="Frau" />
                          <option value="Herr" />
                          <option value="Familie" />
                          <option value="Dr." />
                        </datalist>
                      </FormField>
                      <FormField id="firstName" label={t('fields.firstName')} error={errors.firstName} className="col-span-2">
                        <Input
                          id="firstName"
                          name="firstName"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                        />
                      </FormField>
                    </div>
                    <FormField id="lastName" label={t('fields.lastName')} error={errors.lastName} required>
                      <Input
                        id="lastName"
                        name="lastName"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                      />
                    </FormField>
                  </>
                ) : (
                  <>
                    <FormField id="name" label={t('fields.name')} error={errors.name} required>
                      <Input
                        id="name"
                        name="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </FormField>
                    <FormField id="legalForm" label={t('fields.legalForm')} error={errors.legalForm}>
                      <Input
                        id="legalForm"
                        name="legalForm"
                        value={legalForm}
                        onChange={(e) => setLegalForm(e.target.value)}
                        placeholder={t('legalFormPlaceholder')}
                      />
                    </FormField>
                  </>
                )}

                <FormField id="addressExtra" label={t('fields.addressExtra')} error={errors.addressExtra}>
                  <Input
                    id="addressExtra"
                    name="addressExtra"
                    value={addressExtra}
                    onChange={(e) => setAddressExtra(e.target.value)}
                  />
                </FormField>

                <FormField id="street" label={t('fields.street')} error={errors.street}>
                  <Input
                    id="street"
                    name="street"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                  />
                </FormField>

                <div className="grid grid-cols-3 gap-3">
                  <FormField id="postalCode" label={t('fields.postalCode')} error={errors.postalCode}>
                    <Input
                      id="postalCode"
                      name="postalCode"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                    />
                  </FormField>
                  <FormField id="city" label={t('fields.city')} error={errors.city} className="col-span-2">
                    <Input
                      id="city"
                      name="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <FormField id="country" label={t('fields.country')} error={errors.country}>
                    <Input
                      id="country"
                      name="country"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder={t('countryPlaceholder')}
                    />
                  </FormField>
                  <FormField id="notes" label={t('fields.notes')} error={errors.notes} className="col-span-2">
                    <Input
                      id="notes"
                      name="notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </FormField>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-4 md:col-span-5">
                <span className="text-[13px] font-semibold text-muted-ink">{t('preview')}</span>
                <pre className="min-h-[120px] whitespace-pre-line rounded-md border border-line bg-code-bg p-3 font-body text-[14px] leading-relaxed text-ink">
                  {preview || <span className="italic text-muted-ink">{t('previewPlaceholder')}</span>}
                </pre>
              </div>
            </div>
          </div>

          <DialogFooter className="items-center border-t border-line bg-surface-2 px-6 py-3">
            <span className="mr-auto text-[12px] text-muted-ink">{c('audited')}</span>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {c('cancel')}
            </Button>
            <SubmitButton>{t(`${mode}.submit`)}</SubmitButton>
          </DialogFooter>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
