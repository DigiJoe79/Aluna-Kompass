'use client';

import type { ReclassificationPreview, RetentionView } from '@kompass/module-dms';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ActionForm } from '@/components/forms/action-form';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { idleState } from '@/lib/actions';
import { previewReclassificationAction, reclassifyDocumentAction } from '../actions';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';

/**
 * Art, Betreff und Datum eines abgelegten Eingangs nachträglich ändern (Spec
 * 2026-09-19). Bevor jemand speichert, sagt der Dialog, was mit Nummer und
 * Frist passiert — die Nummer wechselt mit der Art, die Frist mit Art und Datum.
 */
export function ReclassifyDialog({
  document: doc,
  types,
}: {
  document: { id: string; typeKey: string; subject: string; documentDate: string; updatedAt: string };
  types: { key: string; label: string }[];
}) {
  const t = useTranslations('dms.reclassify');
  const tClasses = useTranslations('dms.admin.retentionClasses');
  const fmt = useDateFormat();
  const [open, setOpen] = useState(false);
  const [typeKey, setTypeKey] = useState(doc.typeKey);
  const [documentDate, setDocumentDate] = useState(doc.documentDate);
  const [preview, setPreview] = useState<ReclassificationPreview | null>(null);
  const [, startPreview] = useTransition();
  const [state, action] = useActionState(reclassifyDocumentAction.bind(null, doc.id), idleState);

  useEffect(() => {
    if (!open || !documentDate) return;
    startPreview(async () => setPreview(await previewReclassificationAction(doc.id, typeKey, documentDate)));
  }, [open, doc.id, typeKey, documentDate]);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message ?? '');
      setOpen(false);
    }
  }, [state]);

  const retention = (view: RetentionView) =>
    view.until ? t('retentionUntil', { label: tClasses(view.retentionClass), date: fmt.date(view.until) }) : tClasses(view.retentionClass);
  const retentionChanges =
    preview !== null &&
    (preview.retention.current.retentionClass !== preview.retention.next.retentionClass || preview.retention.current.until !== preview.retention.next.until);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" className="bg-surface shadow-md">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription tone="body">{t('description')}</DialogDescription>
          <ActionForm action={action} state={state} className="flex flex-col gap-4">
            <input type="hidden" name="expectedVersion" value={doc.updatedAt} />
            <FormGrid>
              <FormField id="reclassify-type" label={t('type')}>
                <Select id="reclassify-type" name="typeKey" value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
                  {types.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              {/* Datum neben der Art: beide steuern die Vorschau darunter (Inventar § 3 C). */}
              <FormField id="reclassify-date" label={t('date')} size="s">
                <Input id="reclassify-date" name="documentDate" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} required className="font-mono" />
              </FormField>
              <FormField id="reclassify-subject" label={t('subject')}>
                <Input id="reclassify-subject" name="subject" defaultValue={doc.subject} required maxLength={300} />
              </FormField>
              {preview ? (
                <FormCell size="full" className="space-y-1 rounded-md bg-surface-2 p-3 text-[13px] text-ink-2" aria-live="polite">
                  <p>
                    {preview.number.next
                      ? t('newNumber', { next: preview.number.next, current: preview.number.current ?? '' })
                      : preview.number.numberHidden
                        ? t('numberOnFiling', { current: preview.number.current ?? '' })
                        : t('sameNumber', { current: preview.number.current ?? '' })}
                  </p>
                  {retentionChanges ? (
                    <p>{t('retentionChange', { current: retention(preview.retention.current), next: retention(preview.retention.next) })}</p>
                  ) : null}
                </FormCell>
              ) : null}
            </FormGrid>
            <FormActionBar placement="dialog" mode="create" cancel={() => setOpen(false)} saveLabel={t('save')} state={state} />
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
