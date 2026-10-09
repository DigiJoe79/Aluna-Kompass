'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RecordActions } from '@/components/record-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { deleteDocumentAction, deleteDraftAction, voidDocumentAction } from '../actions';

/**
 * Seltene Aktionen am Dokument im Seitenkopf (MUSTER § C, Spec Seitenkopf § 3.5): „Stornieren …“ (mit Ersatz),
 * „Entwurf löschen …“ und nach Ablauf der Frist „Löschen …“. Je Aktion genau ein gesteuerter Dialog; nach dem Schließen
 * kehrt der Fokus auf ⋯ zurück. Vor Ablauf der Aufbewahrung bleibt „Löschen …“ sichtbar, der Dialog nennt die Frist.
 * Die Aktionsleiste der Seite behält nur die nächsten Schritte (Ablegen, Bearbeiten, Antworten, Umklassifizieren).
 */
export function DocumentActions({
  documentId,
  phase,
  status,
  permissions,
  retention,
}: {
  documentId: string;
  phase: 'draft' | 'issued';
  status: 'draft' | 'issued' | 'voided';
  permissions: { canVoid: boolean; canDeleteDraft: boolean; canEdit: boolean; canManage: boolean };
  retention: { retentionClass: string; until: string | null; due: boolean } | null;
}) {
  const t = useTranslations('dms');
  const tCommon = useTranslations('common');
  const fmt = useDateFormat();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<'void' | 'deleteDraft' | 'purge' | null>(null);
  const close = (next: boolean) => (next ? undefined : setOpen(null));

  const [voidReason, setVoidReason] = useState('');
  const [withReplacement, setWithReplacement] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  const voidFb = useActionFeedback();
  const resetVoid = voidFb.reset;
  useEffect(() => {
    if (open !== 'void') resetVoid();
  }, [open, resetVoid]);

  const purgeRefusal =
    retention && !retention.due
      ? { message: retention.until ? t('deleteDocumentRefusedUntil', { date: fmt.date(retention.until) }) : retention.retentionClass === 'permanent' ? t('retentionPermanent') : t('deleteDocumentBlocked') }
      : undefined;

  return (
    <>
      <RecordActions
        triggerRef={trigger}
        actions={[
          { key: 'void', label: t('voidItem'), kind: 'undoing', onSelect: () => setOpen('void'), hidden: !(phase === 'issued' && status !== 'voided' && permissions.canVoid), testId: 'document-void-trigger' },
          { key: 'deleteDraft', label: t('deleteDraftItem'), kind: 'delete', onSelect: () => setOpen('deleteDraft'), hidden: !(phase === 'draft' && permissions.canDeleteDraft), testId: 'document-delete-draft-trigger' },
          { key: 'purge', label: t('deleteDocumentItem'), kind: 'delete', onSelect: () => setOpen('purge'), hidden: !(retention && permissions.canManage), testId: 'document-purge-trigger' },
        ]}
      />

      <Dialog open={open === 'void'} onOpenChange={close}>
        <DialogContent size="sm" className="bg-surface shadow-md" finalFocus={trigger}>
          <DialogTitle>{t('voidConfirmTitle')}</DialogTitle>
          <DialogDescription tone="body">{t('voidConfirmDescription')}</DialogDescription>
          <FormGrid>
            <FormField id="voidReason" label={t('fields.voidReason')} required>
              <Input id="voidReason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder={t('fields.voidReasonPlaceholder')} />
            </FormField>
            {permissions.canEdit ? (
              <FormField id="void-with-replacement" label={t('voidWithReplacement')} toggle>
                <Checkbox id="void-with-replacement" checked={withReplacement} onCheckedChange={(next) => setWithReplacement(next === true)} />
              </FormField>
            ) : null}
          </FormGrid>
          <FormActionBar
            placement="dialog"
            cancel={() => setOpen(null)}
            destructive
            pending={voidBusy}
            saveDisabled={!voidReason.trim()}
            saveLabel={t('voidConfirmSubmit')}
            note={<span className="text-[12px] text-muted-ink">{tCommon('requiredLegend')}</span>}
            state={voidFb.state}
            onSave={async () => {
              setVoidBusy(true);
              const result = await voidFb.run(() => voidDocumentAction(documentId, voidReason, withReplacement));
              setVoidBusy(false);
              if (result.status === 'success') setOpen(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={open === 'deleteDraft'}
        onOpenChange={close}
        finalFocus={trigger}
        title={t('deleteDraftConfirmTitle')}
        description={t('deleteDraftConfirmDescription')}
        confirmLabel={t('deleteDraftConfirmSubmit')}
        destructive
        action={() => deleteDraftAction(documentId)}
      />

      <ConfirmDialog
        open={open === 'purge'}
        onOpenChange={close}
        finalFocus={trigger}
        title={t('deleteDocumentConfirmTitle')}
        description={t('deleteDocumentConfirmDescription')}
        confirmLabel={t('deleteDocumentConfirmSubmit')}
        destructive
        refusal={purgeRefusal}
        action={() => deleteDocumentAction(documentId)}
      />
    </>
  );
}
