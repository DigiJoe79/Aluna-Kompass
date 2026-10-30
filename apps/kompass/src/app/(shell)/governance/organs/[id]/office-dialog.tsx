'use client';

import type { OfficeFunction, OfficeView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { CountField } from '@/components/count-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Overline } from '@/components/overline';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { saveOfficeAction, setOfficeActiveAction } from '../actions';

const FUNCTIONS: (OfficeFunction | '')[] = ['chair', 'treasurer', 'board', 'auditor', ''];

/** Amt anlegen oder bearbeiten (`md`, HANDOFF2 „aus dem Bestand“); „Archivieren“ links im Fuß beim Bearbeiten. */
export function OfficeDialog({ organId, office, others, onClose, finalFocus }: { organId: string; office: OfficeView | null; others: { id: string; name: string }[]; onClose: () => void; finalFocus?: RefObject<HTMLElement | null> }) {
  const t = useTranslations('governance.office');
  const router = useRouter();
  const [name, setName] = useState(office?.name ?? '');
  const [seats, setSeats] = useState(String(office?.seats ?? 1));
  const [representative, setRepresentative] = useState(office?.representative ?? false);
  const [termMonths, setTermMonths] = useState(office?.termMonths === null || office?.termMonths === undefined ? '' : String(office.termMonths));
  const [untilSuccessor, setUntilSuccessor] = useState(office?.untilSuccessor ?? false);
  const [fn, setFn] = useState<OfficeFunction | ''>(office?.function ?? '');
  const [incompatible, setIncompatible] = useState<string[]>(office?.incompatibleWith ?? []);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const done = (message?: string) => {
    if (message) toast.success(message);
    onClose();
    router.refresh();
  };
  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        saveOfficeAction({
          ...(office ? { id: office.id } : {}),
          organId,
          name,
          seats: Number(seats) || 0,
          representative,
          termMonths: termMonths.trim() === '' ? null : Number(termMonths),
          untilSuccessor,
          function: fn === '' ? null : fn,
          incompatibleWith: incompatible,
        }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status === 'success') done(result.message);
  };
  const archive = async () => {
    if (!office) return;
    const result = await feedback.run(() => setOfficeActiveAction(organId, office.id, !office.active));
    if (result.status === 'success') done(result.message);
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{office ? t('editTitle') : t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              <FormField id="office-name" label={t('name')} required error={errors.name}>
                <Input id="office-name" value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField id="office-seats" label={t('seats')} size="s" error={errors.seats}>
                <CountField id="office-seats" min={1} max={99} value={seats} onChange={(e) => setSeats(e.target.value)} />
              </FormField>
              <FormField id="office-term" label={t('termMonths')} hint={t('termMonthsHint')} size="s" error={errors.termMonths}>
                <CountField id="office-term" min={1} max={240} value={termMonths} unit={{ one: t('month'), other: t('months') }} onChange={(e) => setTermMonths(e.target.value)} />
              </FormField>
              <FormField id="office-function" label={t('function')} hint={t('functionHint')} error={errors.function}>
                <Select id="office-function" value={fn} onChange={(e) => setFn(e.target.value as OfficeFunction | '')}>
                  {FUNCTIONS.map((f) => (
                    <option key={f || 'none'} value={f}>{t(`functions.${f || 'none'}`)}</option>
                  ))}
                </Select>
              </FormField>
              <FormField id="office-representative" label={t('representative')} size="full" toggle>
                <Checkbox id="office-representative" checked={representative} onCheckedChange={(c) => setRepresentative(c)} />
              </FormField>
              <FormField id="office-until-successor" label={t('untilSuccessor')} size="full" toggle>
                <Checkbox id="office-until-successor" checked={untilSuccessor} onCheckedChange={(c) => setUntilSuccessor(c)} />
              </FormField>
              {others.length > 0 ? (
                <FormCell size="full" as="fieldset">
                  <Overline field as="div">{t('incompatible')}</Overline>
                  <div className="mt-2 flex flex-col gap-2">
                    {others.map((o) => (
                      <FormField key={o.id} id={`office-incompatible-${o.id}`} label={o.name} size="full" toggle>
                        <Checkbox
                          id={`office-incompatible-${o.id}`}
                          checked={incompatible.includes(o.id)}
                          onCheckedChange={(c) => setIncompatible((list) => (c ? [...list, o.id] : list.filter((x) => x !== o.id)))}
                        />
                      </FormField>
                    ))}
                  </div>
                </FormCell>
              ) : null}
            </FormGrid>
          </DialogBody>
        </form>
        <FormActionBar
          placement="dialog"
          mode={office ? 'edit' : 'create'}
          cancel={onClose}
          pending={pending}
          onSave={() => void save()}
          state={feedback.state}
          {...(office ? { recordAction: { key: 'archive', label: office.active ? t('archive') : t('activate'), kind: 'reversible' as const, onSelect: () => void archive() } } : {})}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Primär im Kopf des Organs: „Amt anlegen“ öffnet den Dialog. */
export function OfficeCreateButton({ organId, others }: { organId: string; others: { id: string; name: string }[] }) {
  const t = useTranslations('governance.office');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>{t('create')}</Button>
      {open ? <OfficeDialog organId={organId} office={null} others={others} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
