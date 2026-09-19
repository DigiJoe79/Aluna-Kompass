'use client';

import type { ReclassificationPreview, RetentionView } from '@kompass/module-dms';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ActionForm } from '@/components/forms/action-form';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { idleState } from '@/lib/actions';
import { previewReclassificationAction, reclassifyDocumentAction } from '../actions';

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
    } else if (state.status === 'error') {
      toast.error(state.message);
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
        <DialogContent className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
          <DialogDescription className="text-[14px] text-ink-2">{t('description')}</DialogDescription>
          <ActionForm action={action} state={state} className="flex flex-col gap-4">
            <input type="hidden" name="expectedVersion" value={doc.updatedAt} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reclassify-type">{t('type')}</Label>
              <Select id="reclassify-type" name="typeKey" value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
                {types.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reclassify-subject">{t('subject')}</Label>
              <Input id="reclassify-subject" name="subject" defaultValue={doc.subject} required maxLength={300} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reclassify-date">{t('date')}</Label>
              <Input id="reclassify-date" name="documentDate" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} required className="font-mono" />
            </div>
            {preview ? (
              <div className="space-y-1 rounded-md bg-surface-2 p-3 text-[13px] text-ink-2" aria-live="polite">
                <p>
                  {preview.number.next
                    ? t('newNumber', { next: preview.number.next, current: preview.number.current ?? '' })
                    : t('sameNumber', { current: preview.number.current ?? '' })}
                </p>
                {retentionChanges ? (
                  <p>{t('retentionChange', { current: retention(preview.retention.current), next: retention(preview.retention.next) })}</p>
                ) : null}
              </div>
            ) : null}
            <DialogFooter className="items-center">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <SubmitButton>{t('save')}</SubmitButton>
            </DialogFooter>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
