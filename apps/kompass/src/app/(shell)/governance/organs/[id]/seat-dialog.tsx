'use client';

import type { TermWarning } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FixedValue } from '@/components/fixed-value';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { startTermAction } from '../actions';

/** Herkunft einer Besetzung von Hand; `elected` entsteht nur aus einer Wahl. */
const ORIGINS = ['substitute', 'appointed', 'backfilled', 'courtAppointed'] as const;

/**
 * „Besetzen …“ (`md`): Person, Herkunft, Seit, Nachweis, Notiz. Warnungen des Dienstes (Ersatzbestellung ohne Satzung,
 * unvereinbare Ämter) stehen danach als Hinweis im Dialog — keine Sperre; „Amt voll“ ist eine Ablehnung.
 */
export function SeatDialog({ organId, office, today, canPickContacts, canPickDocuments, onClose, finalFocus }: { organId: string; office: { id: string; name: string }; today: string; canPickContacts: boolean; canPickDocuments: boolean; onClose: () => void; finalFocus?: RefObject<HTMLElement | null> }) {
  const t = useTranslations('governance.seat');
  const router = useRouter();
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [origin, setOrigin] = useState<(typeof ORIGINS)[number]>('appointed');
  const [since, setSince] = useState(today);
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [warnings, setWarnings] = useState<TermWarning[] | null>(null);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () => startTermAction({ organId, officeId: office.id, contactId: contact?.id ?? '', since, origin, ...(document ? { documentId: document.id } : {}), ...(note.trim() ? { note: note.trim() } : {}) }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    router.refresh();
    const found = ((result.data as { warnings?: TermWarning[] } | undefined)?.warnings ?? []);
    if (found.length === 0) {
      toast.success(result.message ?? '');
      onClose();
    } else setWarnings(found);
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('title', { office: office.name })}</DialogTitle>
          {warnings ? <DialogDescription>{t('savedWithHints')}</DialogDescription> : null}
        </DialogHeader>
        {warnings ? (
          <>
            <DialogBody>
              <div className="flex flex-col gap-3">
                {warnings.map((w) => (
                  <Notice key={w} level="warn">{t(`warnings.${w}`)}</Notice>
                ))}
              </div>
            </DialogBody>
            {/* Nur „Schließen“: gespeichert ist schon (MUSTER § B, Dialog ohne Hauptaktion). */}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>{t('close')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <DialogBody>
                <FormGrid>
                  <FormCell size="full">
                    {canPickContacts ? (
                      <ContactPicker id="seat-contact" name="contactId" label={t('person')} value={contact} onChange={setContact} required canCreate />
                    ) : (
                      <FixedValue id="seat-contact" label={t('person')} value={null} reason={t('personNoRight')} size="full" />
                    )}
                  </FormCell>
                  <FormField id="seat-origin" label={t('origin')} required error={errors.origin}>
                    <Select id="seat-origin" value={origin} onChange={(e) => setOrigin(e.target.value as (typeof ORIGINS)[number])}>
                      {ORIGINS.map((o) => (
                        <option key={o} value={o}>{t(`origins.${o}`)}</option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="seat-since" label={t('since')} required size="s" error={errors.since}>
                    <Input id="seat-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
                  </FormField>
                  {canPickDocuments ? (
                    <FormCell size="full">
                      <DocumentPicker id="seat-document" name="documentId" label={t('proof')} value={document} onChange={setDocument} />
                    </FormCell>
                  ) : null}
                  <FormField id="seat-note" label={t('note')} size="full" error={errors.note}>
                    <Textarea id="seat-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                  </FormField>
                </FormGrid>
              </DialogBody>
            </form>
            <FormActionBar placement="dialog" mode="create" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} saveLabel={t('save')} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
