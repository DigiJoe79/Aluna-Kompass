'use client';

import { formatPostalAddress } from '@kompass/module-contacts';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createContactAction } from './actions';
import { Select } from '@/components/ui/select';

/**
 * Dasselbe Formular an zwei Stellen: als eigener Knopf auf der Kontaktseite,
 * und als Overlay aus dem Suchfeld heraus. Wer es von außen öffnet, gibt
 * `open`/`onOpenChange` mit und bekommt über `onCreated` den neuen Kontakt
 * zurück — ohne diese Angaben bleibt alles, wie es war.
 */
export function CreateContactDialog({
  open: controlledOpen,
  onOpenChange,
  onCreated,
  withTrigger = true,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (contact: { id: string; name: string }) => void;
  withTrigger?: boolean;
} = {}) {
  const t = useTranslations('contacts');
  const c = useTranslations('common');
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [state, action] = useActionState(createContactAction, idleState);

  const [kind, setKind] = useState<'person' | 'organization'>('person');
  const [salutation, setSalutation] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [name, setName] = useState('');
  const [legalForm, setLegalForm] = useState('');
  const [addressExtra, setAddressExtra] = useState('');
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setKind('person');
    setSalutation('');
    setFirstName('');
    setLastName('');
    setName('');
    setLegalForm('');
    setAddressExtra('');
    setStreet('');
    setPostalCode('');
    setCity('');
    setCountry('');
    setNotes('');
  };

  useEffect(() => {
    if (state.status === 'success') {
      const created = state.data as { id: string; name: string } | undefined;
      if (created) onCreated?.(created);
      setOpen(false);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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
        if (!next) reset();
      }}
    >
      {withTrigger ? (
        <DialogTrigger
          render={
            <Button>
              <Plus className="size-3.5" aria-hidden />
              {t('create.trigger')}
            </Button>
          }
        />
      ) : null}
      <DialogContent className="w-full sm:max-w-[840px] bg-surface p-0 shadow-md">
        <form action={action}>
          <div className="p-6">
            <DialogTitle className="font-heading text-[19px]">{t('create.title')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('create.description')}</DialogDescription>

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
                    name="kind"
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
                        placeholder="z. B. e. V., GmbH"
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
                      placeholder="DE"
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
            <SubmitButton>{t('create.submit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
