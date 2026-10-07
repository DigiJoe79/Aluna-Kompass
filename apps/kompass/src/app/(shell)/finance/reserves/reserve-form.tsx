'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { RESERVE_KINDS, type ReserveKind } from '@/lib/finance/reserves';
import { saveReserveAction, saveReserveUploadAction, updateReserveAction } from './actions';
import { ResolutionField } from './resolution-field';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';

/** Was „Bearbeiten“ vom Stammsatz braucht — Vortrag und Aktiv-Schalter reisen unverändert mit. */
export interface ReserveInitial {
  id: string;
  kind: ReserveKind;
  name: string;
  purposeText: string | null;
  purposeId: string | null;
  carryForwardCents: number | null;
  carryForwardDate: string | null;
  isActive: boolean;
  updatedAt: string;
}

/**
 * Stammsatz (Annahme 1, `finance.setup`): Art, Bezeichnung, wofür, optional
 * ein Zweck, Beschluss Pflicht. Mit `initial` derselbe Dialog als
 * „Bearbeiten“ (Befund 40) — der Beschluss wird dann über „Beschluss
 * ersetzen“ getauscht, nicht hier.
 */
export function ReserveForm({ purposes, initial, onClose, onSaved }: { purposes: { id: string; name: string }[]; initial?: ReserveInitial; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('finance.reserves');
  const [kind, setKind] = useState<ReserveKind>(initial?.kind ?? 'projectFunds');
  const [name, setName] = useState(initial?.name ?? '');
  const [purposeText, setPurposeText] = useState(initial?.purposeText ?? '');
  const [purposeId, setPurposeId] = useState(initial?.purposeId ?? '');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const needsText = kind === 'projectFunds' || kind === 'replacement';
  const canSave = name.trim() !== '' && (!needsText || purposeText.trim() !== '') && (!!initial || !!document !== !!file);

  const submit = async () => {
    setPending(true);
    const base = { kind, name: name.trim(), purposeText: purposeText.trim() || null, purposeId: purposeId || null };
    const call = (): Promise<ActionState> => {
      if (initial) {
        return updateReserveAction({
          ...base,
          id: initial.id,
          expectedVersion: initial.updatedAt,
          carryForwardCents: initial.carryForwardCents,
          carryForwardDate: initial.carryForwardDate,
          isActive: initial.isActive,
        });
      }
      if (!file) return saveReserveAction({ ...base, resolutionDocumentId: document!.id });
      const formData = new FormData();
      formData.append('kind', base.kind);
      formData.append('name', base.name);
      if (base.purposeText) formData.append('purposeText', base.purposeText);
      if (base.purposeId) formData.append('purposeId', base.purposeId);
      formData.append('file', file);
      return saveReserveUploadAction(formData);
    };
    const result = await feedback.run(call, { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle>{initial ? t('form.editTitle', { name: initial.name }) : t('form.title')}</DialogTitle>
        <div data-testid="reserve-form">
          <FormGrid>
            <FormField id="reserve-kind" label={t('form.kind')}>
              <Select id="reserve-kind" value={kind} onChange={(e) => setKind(e.target.value as ReserveKind)}>
                {RESERVE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="reserve-name" label={t('form.name')} required>
              <Input id="reserve-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField id="reserve-purpose-text" label={t('form.purposeText')} required={needsText} hint={t('form.purposeTextHint')} size="l">
              <Textarea id="reserve-purpose-text" rows={2} value={purposeText} onChange={(e) => setPurposeText(e.target.value)} />
            </FormField>
            <FormField id="reserve-purpose" label={t('form.purpose')}>
              <Select id="reserve-purpose" value={purposeId} onChange={(e) => setPurposeId(e.target.value)}>
                <option value="">{t('form.noPurpose')}</option>
                {purposes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {initial ? null : (
              <FormCell size="full">
                <ResolutionField id="reserve-resolution" document={document} onDocument={setDocument} onFile={setFile} />
              </FormCell>
            )}
          </FormGrid>
        </div>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!canSave} saveLabel={initial ? t('form.update') : t('form.save')} saveTestId="reserve-form-save" onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
