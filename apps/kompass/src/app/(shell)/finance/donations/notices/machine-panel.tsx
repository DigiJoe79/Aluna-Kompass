'use client';

import type { MachineProcedureStatus, SignerView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { BlockedState } from '@/components/blocked-state';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createNotificationLetterAction, saveSignerAction, uploadFacsimileAction } from './actions';

/**
 * „Maschinell erstellte Bestätigungen“ (C3, F6a Task 8): die Unterzeichner
 * mit Zeitraum und Tag der Anzeige, je einer mit dem Bild seiner Unterschrift
 * (hochgeladen hierher, gezeigt über den Faksimile-Handler — nie über die
 * Mediathek), das Anzeigeschreiben als Entwurf der Akte und die Statuszeile.
 * Ohne `dms.create` steht statt des Knopfs, wer es kann (`BlockedState`).
 */
export function MachinePanel({ signers, status, canIssue, canDraftLetter, draftNames, facsimileMaxBytes }: { signers: SignerView[]; status: MachineProcedureStatus; canIssue: boolean; canDraftLetter: boolean; draftNames: string[]; facsimileMaxBytes: number }) {
  const t = useTranslations('finance.donations.machine');
  const { date } = useDateFormat();
  const router = useRouter();
  const [editing, setEditing] = useState<SignerView | 'new' | null>(null);
  const [pending, setPending] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const letterSigner = status.signer ?? signers[0] ?? null;

  const missing = status.missing.map((key) => t(`missing.${key}`)).join(', ');

  const upload = async (signerId: string, file: File | undefined) => {
    if (!file) return;
    setPending(true);
    const result = await uploadFacsimileAction(signerId, new Uint8Array(await file.arrayBuffer()), file.type);
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      router.refresh();
    }
  };

  const draftLetter = async () => {
    if (!letterSigner) return;
    setPending(true);
    const result = await createNotificationLetterAction(letterSigner.id);
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      setDraftId((result.data as { id: string }).id);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-5" data-testid="machine-panel" aria-labelledby="machine-title">
      <div className="space-y-1">
        <h2 id="machine-title" className="font-heading text-[17px]">{t('title')}</h2>
        <p className="text-[13px] text-ink-2">{t('intro')}</p>
      </div>

      <Notice level={status.complete ? 'hint' : 'warn'}>
        <span data-testid="machine-status">{status.complete ? t('statusComplete', { name: status.signer?.signerName ?? '' }) : t('statusIncomplete', { missing })}</span>
      </Notice>

      {signers.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('empty')}</p>
      ) : (
        <Table aria-label={t('tableLabel')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.period')}</TableHead>
              <TableHead>{t('columns.notifiedOn')}</TableHead>
              <TableHead>{t('columns.facsimile')}</TableHead>
              {canIssue ? <TableHead className="text-right">{t('columns.actions')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {signers.map((signer) => (
              <TableRow key={signer.id} data-testid="signer-row">
                <TableCell>
                  <span className="font-semibold text-ink">{signer.signerName}</span>{' '}
                  <StatusBadge tone={signer.state === 'current' ? 'success' : 'neutral'}>{t(`state.${signer.state}`)}</StatusBadge>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{t('period', { from: date(signer.validFrom), to: signer.validTo ? date(signer.validTo) : t('openEnd') })}</TableCell>
                <TableCell className="font-mono tabular-nums">{signer.notifiedOn ? date(signer.notifiedOn) : <span className="font-sans text-muted-ink">{t('notNotified')}</span>}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1.5">
                    {!signer.hasFacsimile ? <span className="text-[13px] text-muted-ink">{t('noFacsimile')}</span> : null}
                    {canIssue ? (
                      <ReceiptDrop
                        key={signer.facsimileChecksum ?? 'none'}
                        kind="image"
                        maxBytes={facsimileMaxBytes}
                        disabled={pending}
                        previewSrc={signer.hasFacsimile ? `/finance/donations/facsimile?signerId=${encodeURIComponent(signer.id)}&v=${encodeURIComponent((signer.facsimileChecksum ?? '').slice(0, 12))}` : null}
                        previewAlt={t('facsimileAlt', { name: signer.signerName })}
                        onFiles={(files) => void upload(signer.id, files[0])}
                      />
                    ) : null}
                  </div>
                </TableCell>
                {canIssue ? (
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(signer)}>{t('edit')}</Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canIssue ? <p className="text-[12px] text-muted-ink">{t('facsimilePrivacy')} {t('uploadHint')}</p> : null}

      {canIssue ? (
        <div className="flex flex-wrap items-start gap-3">
          <Button type="button" variant="outline" onClick={() => setEditing('new')}>{t('add')}</Button>
          {letterSigner ? (
            canDraftLetter ? (
              <div className="space-y-1">
                <Button type="button" variant="outline" disabled={pending} onClick={() => void draftLetter()}>{t('letter')}</Button>
                <p className="max-w-[420px] text-[12px] text-muted-ink">{t('letterHint')}</p>
                {draftId ? <Link href={`/dms/${draftId}`} className="text-[13px] font-semibold text-ink underline underline-offset-2">{t('openDraft')}</Link> : null}
              </div>
            ) : (
              <BlockedState step={t('letter')} title={t('letterBlockedTitle')}>
                {draftNames.length > 0 ? t('letterBlockedText', { names: draftNames.join(', ') }) : t('letterBlockedNobody')}
              </BlockedState>
            )
          ) : null}
        </div>
      ) : null}

      {editing ? <SignerDialog signer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function SignerDialog({ signer, onClose }: { signer: SignerView | null; onClose: () => void }) {
  const td = useTranslations('finance.donations.machine.dialog');
  const router = useRouter();
  const [signerName, setSignerName] = useState(signer?.signerName ?? '');
  const [validFrom, setValidFrom] = useState(signer?.validFrom ?? '');
  const [validTo, setValidTo] = useState(signer?.validTo ?? '');
  const [notifiedOn, setNotifiedOn] = useState(signer?.notifiedOn ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    const result = await saveSignerAction({ id: signer?.id, signerName, validFrom, validTo: validTo || null, notifiedOn: notifiedOn || null });
    setPending(false);
    if (result.status === 'error') {
      setErrors(result.fieldErrors);
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onClose();
      router.refresh();
    }
  };

  const field = (id: string, label: string, node: React.ReactNode, required: boolean, error?: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required}>{label}</Label>
      {node}
      {hint ? <p className="text-[12px] text-muted-ink">{hint}</p> : null}
      {error ? <p className="text-[12px] text-error">{error}</p> : null}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[520px]">
        <DialogTitle className="font-heading text-[19px]">{signer ? td('editTitle') : td('addTitle')}</DialogTitle>
        {field('signer-name', td('name'), <Input id="signer-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} />, true, errors.signerName)}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('signer-valid-from', td('validFrom'), <Input id="signer-valid-from" type="date" className="font-mono" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />, true, errors.validFrom)}
          {field('signer-valid-to', td('validTo'), <Input id="signer-valid-to" type="date" className="font-mono" value={validTo} onChange={(e) => setValidTo(e.target.value)} />, false, errors.validTo, td('validToHint'))}
        </div>
        {field('signer-notified-on', td('notifiedOn'), <Input id="signer-notified-on" type="date" className="font-mono" value={notifiedOn} onChange={(e) => setNotifiedOn(e.target.value)} />, false, errors.notifiedOn)}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{td('cancel')}</Button>
          <Button type="button" disabled={pending || signerName.trim() === '' || validFrom === ''} onClick={() => void submit()}>{td('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
