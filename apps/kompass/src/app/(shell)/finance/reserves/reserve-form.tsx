'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { RESERVE_KINDS, type ReserveKind } from '@/lib/finance/reserves';
import { saveReserveAction, saveReserveUploadAction, updateReserveAction } from './actions';
import { ResolutionField } from './resolution-field';

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
  const [error, setError] = useState<string | null>(null);

  const needsText = kind === 'projectFunds' || kind === 'replacement';
  const canSave = !pending && name.trim() !== '' && (!needsText || purposeText.trim() !== '') && (!!initial || !!document !== !!file);

  const submit = async () => {
    setPending(true);
    setError(null);
    const base = { kind, name: name.trim(), purposeText: purposeText.trim() || null, purposeId: purposeId || null };
    let result;
    if (initial) {
      result = await updateReserveAction({
        ...base,
        id: initial.id,
        expectedVersion: initial.updatedAt,
        carryForwardCents: initial.carryForwardCents,
        carryForwardDate: initial.carryForwardDate,
        isActive: initial.isActive,
      });
    } else if (file) {
      const formData = new FormData();
      formData.append('kind', base.kind);
      formData.append('name', base.name);
      if (base.purposeText) formData.append('purposeText', base.purposeText);
      if (base.purposeId) formData.append('purposeId', base.purposeId);
      formData.append('file', file);
      result = await saveReserveUploadAction(formData);
    } else {
      result = await saveReserveAction({ ...base, resolutionDocumentId: document!.id });
    }
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[480px]">
        <DialogTitle className="font-heading text-[19px]">{initial ? t('form.editTitle', { name: initial.name }) : t('form.title')}</DialogTitle>
        <div className="space-y-3.5" data-testid="reserve-form">
          {error ? <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error" role="alert">{error}</div> : null}
          <div className="space-y-1.5">
            <Label htmlFor="reserve-kind">{t('form.kind')}</Label>
            <Select id="reserve-kind" value={kind} onChange={(e) => setKind(e.target.value as ReserveKind)}>
              {RESERVE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reserve-name" required>
              {t('form.name')}
            </Label>
            <Input id="reserve-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reserve-purpose-text" required={needsText}>
              {t('form.purposeText')}
            </Label>
            <Textarea id="reserve-purpose-text" rows={2} value={purposeText} onChange={(e) => setPurposeText(e.target.value)} />
            <p className="text-[12px] text-muted-ink">{t('form.purposeTextHint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reserve-purpose">{t('form.purpose')}</Label>
            <Select id="reserve-purpose" value={purposeId} onChange={(e) => setPurposeId(e.target.value)}>
              <option value="">{t('form.noPurpose')}</option>
              {purposes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          {initial ? null : <ResolutionField id="reserve-resolution" document={document} onDocument={setDocument} onFile={setFile} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('movement.cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void submit()} data-testid="reserve-form-save">
            {initial ? t('form.update') : t('form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
