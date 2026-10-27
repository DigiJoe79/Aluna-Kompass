'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { AmountField } from '@/components/finance/amount-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveOtherAssetAction } from './actions';
import type { OtherAssetRow } from './other-asset-list';

/**
 * Eintrag anlegen und bearbeiten (Board 11f, Dialog `md`): Art · Bezeichnung · Wert · Seit · Grundlage · Beleg aus
 * der Akte. Bearbeiten ist für Korrekturen gedacht und sagt, dass festgeschriebene Berichte ihren Stand behalten; ein
 * neuer Wert ab einem Tag geht über „Neuer Wert ab …“. Speichern ist nie gesperrt, der Dienst nennt, was fehlt.
 */
export function OtherAssetDialog({ open, onOpenChange, entry, today }: { open: boolean; onOpenChange: (open: boolean) => void; entry: OtherAssetRow | null; today: string }) {
  const t = useTranslations('finance.otherAssets.dialog');
  const router = useRouter();
  const [kind, setKind] = useState<'asset' | 'liability'>('asset');
  const [label, setLabel] = useState('');
  const [valueText, setValueText] = useState('');
  const [from, setFrom] = useState(today);
  const [basis, setBasis] = useState('');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setKind(entry?.kind ?? 'asset');
    setLabel(entry?.label ?? '');
    setValueText(entry ? formatAmount(entry.valueCents) : '');
    setFrom(entry?.recordedFrom ?? today);
    setBasis(entry?.basis ?? '');
    setDocument(entry?.documentId ? { id: entry.documentId, number: entry.documentNumber ?? null, subject: entry.documentSubject ?? '', phase: 'issued' } : null);
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () => saveOtherAssetAction({ id: entry?.id, expectedVersion: entry?.updatedAt, kind, label, valueCents: parseAmount(valueText), basis, recordedFrom: from, documentId: document?.id ?? null }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="other-asset-dialog">
        <DialogHeader>
          <DialogTitle>{entry ? t('editTitle') : t('createTitle')}</DialogTitle>
          {entry ? <DialogDescription tone="meta">{t('editNote')}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="other-asset-kind" label={t('kind')} hint={t('kindHint')} size="full">
              <Segmented
                className="self-start"
                aria-label={t('kind')}
                value={kind}
                onValueChange={(v) => setKind(v)}
                options={[
                  { value: 'asset', label: t('kinds.asset') },
                  { value: 'liability', label: t('kinds.liability') },
                ]}
              />
            </FormField>
            <FormField id="other-asset-label" label={t('label')} required error={errors.label} size="full">
              <Input id="other-asset-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </FormField>
            <FormField id="other-asset-value" label={t('value')} required error={errors.value} size="s">
              <AmountField id="other-asset-value" name="value" value={valueText} onChange={setValueText} required />
            </FormField>
            <FormField id="other-asset-from" label={t('from')} required error={errors.recordedFrom} size="s">
              <Input id="other-asset-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </FormField>
            <FormField id="other-asset-basis" label={t('basis')} hint={t('basisHint')} required error={errors.basis} size="full">
              <Input id="other-asset-basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
            </FormField>
            <FormCell size="full">
              <DocumentPicker id="other-asset-document" name="documentId" label={t('document')} value={document} onChange={setDocument} />
            </FormCell>
          </FormGrid>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode={entry ? 'run' : 'create'}
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={entry ? t('save') : t('create')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['label', 'value', 'recordedFrom', 'basis'])}
        />
      </DialogContent>
    </Dialog>
  );
}
