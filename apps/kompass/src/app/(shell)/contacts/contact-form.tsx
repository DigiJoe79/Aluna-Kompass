'use client';

import { formatPostalAddress } from '@kompass/module-contacts/address';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
              <Button>
                <Pencil className="size-3.5" aria-hidden />
                {t('edit.trigger')}
              </Button>
            ) : (
              <Button>
                {t('create.trigger')}
              </Button>
            )
          }
        />
      ) : null}
      {/* fixed-footer: Kopf und Leiste stehen fest, die Mitte scrollt — mit Abschnitten ist die Maske höher als ein flaches Fenster. */}
      <DialogContent size="lg" layout="fixed-footer" className="bg-surface shadow-md">
        <ActionForm action={action} state={state} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle className="font-heading text-[19px]">{contact ? t(contact.kind === 'organization' ? 'edit.titleOrganization' : 'edit.titlePerson') : t('create.title')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t(`${mode}.description`)}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {contact ? (
              <>
                <input type="hidden" name="id" value={contact.id} />
                <input type="hidden" name="expectedVersion" value={newer(contact.updatedAt, savedVersion)} />
                <input type="hidden" name="kind" value={contact.kind} />
              </>
            ) : null}

            <section>
              <h3 className="text-[15px] font-semibold">{t('sections.name')}</h3>
              <div className="mt-3">
                <FormGrid>
                  {/* Beim Bearbeiten steht die Art im Titel, nicht als gesperrtes Feld (Entscheidung zum Inventar). */}
                  {contact ? null : (
                    <FormField id="kind" label={t('fields.kind')} size="s">
                      <Select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as 'person' | 'organization')}>
                        <option value="person">{t('fields.person')}</option>
                        <option value="organization">{t('fields.organization')}</option>
                      </Select>
                    </FormField>
                  )}
                  {kind === 'person' ? (
                    <>
                      <FormField id="salutation" label={t('fields.salutation')} error={errors.salutation} size="s">
                        <Input id="salutation" name="salutation" list="salutations" value={salutation} onChange={(e) => setSalutation(e.target.value)} />
                        <datalist id="salutations">
                          {(['ms', 'mr', 'family'] as const).map((key) => (
                            <option key={key} value={t(`fields.salutationSuggestions.${key}`)} />
                          ))}
                        </datalist>
                      </FormField>
                      <FormField id="firstName" label={t('fields.firstName')} error={errors.firstName}>
                        <Input id="firstName" name="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                      </FormField>
                      <FormField id="lastName" label={t('fields.lastName')} error={errors.lastName} required>
                        <Input id="lastName" name="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                      </FormField>
                    </>
                  ) : (
                    <>
                      <FormField id="name" label={t('fields.name')} error={errors.name} required>
                        <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
                      </FormField>
                      <FormField id="legalForm" label={t('fields.legalForm')} error={errors.legalForm} size="s">
                        <Input id="legalForm" name="legalForm" value={legalForm} onChange={(e) => setLegalForm(e.target.value)} placeholder={t('legalFormPlaceholder')} />
                      </FormField>
                    </>
                  )}
                </FormGrid>
              </div>
            </section>

            <section className="mt-5 border-t border-line pt-5">
              <h3 className="text-[15px] font-semibold">{t('sections.address')}</h3>
              <div className="mt-3">
                <FormGrid>
                  <FormField id="addressExtra" label={t('fields.addressExtra')} error={errors.addressExtra}>
                    <Input id="addressExtra" name="addressExtra" value={addressExtra} onChange={(e) => setAddressExtra(e.target.value)} />
                  </FormField>
                  <FormField id="country" label={t('fields.country')} error={errors.country} size="s">
                    <Input id="country" name="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder={t('countryPlaceholder')} />
                  </FormField>
                  <FormField id="street" label={t('fields.street')} error={errors.street}>
                    <Input id="street" name="street" value={street} onChange={(e) => setStreet(e.target.value)} />
                  </FormField>
                  <FormField id="postalCode" label={t('fields.postalCode')} error={errors.postalCode} size="s">
                    <Input id="postalCode" name="postalCode" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                  </FormField>
                  <FormField id="city" label={t('fields.city')} error={errors.city} size="s">
                    <Input id="city" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
                  </FormField>
                  {/* Die Vorschau als ruhige Anzeige unter der Anschrift, keine Karte in der Karte (Entscheidung zum Inventar). */}
                  <FormCell size="full" className="flex flex-col gap-1.5 rounded-md bg-surface-2 px-3 py-2.5">
                    <span className="text-[13px] font-semibold text-muted-ink">{t('preview')}</span>
                    <pre className="whitespace-pre-line font-body text-[14px] leading-relaxed text-ink">
                      {preview || <span className="italic text-muted-ink">{t('previewPlaceholder')}</span>}
                    </pre>
                  </FormCell>
                </FormGrid>
              </div>
            </section>

            <section className="mt-5 border-t border-line pt-5">
              <h3 className="text-[15px] font-semibold">{t('sections.notes')}</h3>
              <div className="mt-3">
                <FormGrid>
                  <FormField id="notes" label={t('fields.notes')} error={errors.notes} size="l">
                    <Textarea id="notes" name="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </FormField>
                </FormGrid>
              </div>
            </section>
          </DialogBody>

          <FormActionBar placement="dialog" mode="create" cancel={() => setOpen(false)} saveLabel={t(`${mode}.submit`)} note={c('audited')} state={state} />
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
