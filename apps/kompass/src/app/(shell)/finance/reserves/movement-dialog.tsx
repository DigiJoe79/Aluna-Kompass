'use client';

import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { reserveBalanceAfter, type ReserveMovementKind } from '@/lib/finance/reserves';
import { recordReserveMovementAction, recordReserveMovementUploadAction } from './actions';
import { ResolutionField } from './resolution-field';

export interface MovementReserve {
  id: string;
  name: string;
  kind: 'projectFunds' | 'replacement' | 'free' | 'participation';
  balanceCents: number;
}

const KINDS: ReserveMovementKind[] = ['allocate', 'withdraw', 'dissolve'];

/**
 * Vorgang-Dialog (Designer-README 4d, Annahme 2): Segment zuführen ·
 * entnehmen · auflösen, Datum, „für das Geschäftsjahr“ nur beim Zuführen in
 * eine freie Rücklage, Betrag (beim Auflösen der ganze Bestand), Beschluss
 * Pflicht, und der Satz „Danach: Bestand … Auf den Bankkonten und Kassen
 * ändert sich nichts.“
 */
export function MovementDialog({
  reserve,
  today,
  fiscalYears,
  defaultFiscalYearId,
  onClose,
  onSaved,
}: {
  reserve: MovementReserve;
  today: string;
  fiscalYears: { id: string; designation: string }[];
  defaultFiscalYearId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('finance.reserves.movement');
  const [kind, setKind] = useState<ReserveMovementKind>('allocate');
  const [date, setDate] = useState(today);
  const [forYear, setForYear] = useState(defaultFiscalYearId ?? '');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Befund S: über dem Höchstbetrag der freien Rücklage fragt der Dienst nach einer Begründung — kein Verbot.
  const [capProblem, setCapProblem] = useState<string | null>(null);
  const [capReason, setCapReason] = useState('');

  const amountCents = kind === 'dissolve' || amountText.trim() === '' ? null : parseAmount(amountText);
  const showForYear = kind === 'allocate' && reserve.kind === 'free';
  const canSave = !pending && !!date && (kind === 'dissolve' || (amountCents !== null && amountCents > 0)) && !!document !== !!file;
  const after = reserveBalanceAfter(reserve.balanceCents, kind, amountCents);

  // Segment als Radiogruppe (HANDOFF § 6): ein Tab-Halt, Pfeiltasten wechseln und wandern ringsum.
  const onSegmentKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = KINDS[(KINDS.indexOf(kind) + step + KINDS.length) % KINDS.length]!;
    setKind(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-testid="movement-kind-${next}"]`)?.focus();
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    const base = {
      reserveId: reserve.id,
      kind,
      movementDate: date,
      amountCents: kind === 'dissolve' ? undefined : amountCents ?? undefined,
      forFiscalYearId: showForYear && forYear ? forYear : undefined,
      note: note.trim() || null,
      ...(capReason.trim() ? { capReason: capReason.trim() } : {}),
    };
    let result;
    if (file) {
      const formData = new FormData();
      formData.append('reserveId', base.reserveId);
      formData.append('kind', base.kind);
      formData.append('movementDate', base.movementDate);
      if (base.amountCents !== undefined) formData.append('amountCents', String(base.amountCents));
      if (base.forFiscalYearId) formData.append('forFiscalYearId', base.forFiscalYearId);
      if (base.note) formData.append('note', base.note);
      if (base.capReason) formData.append('capReason', base.capReason);
      formData.append('file', file);
      result = await recordReserveMovementUploadAction(formData);
    } else {
      result = await recordReserveMovementAction({ ...base, resolutionDocumentId: document!.id });
    }
    setPending(false);
    if (result.status === 'error') {
      if (result.code === 'freeReserveCapExceeded') {
        setCapProblem(result.detail ?? result.message);
        return;
      }
      setError(result.message);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[480px]">
        <DialogTitle className="font-heading text-[19px]">{t('title', { name: reserve.name })}</DialogTitle>
        <div className="space-y-3.5" data-testid="movement-dialog">
          {error ? (
            <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error" role="alert" data-testid="movement-error">
              {error}
            </div>
          ) : null}
          <div role="radiogroup" aria-label={t('kindLabel')} className="grid grid-cols-3 gap-1 rounded-md border border-line bg-surface-2 p-1" onKeyDown={onSegmentKey}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                tabIndex={kind === k ? 0 : -1}
                data-testid={`movement-kind-${k}`}
                onClick={() => setKind(k)}
                className={`rounded-sm px-2 py-1.5 text-[13px] font-semibold ${kind === k ? 'bg-surface text-ink shadow-sm' : 'text-ink-2'}`}
              >
                {t(`kinds.${k}`)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="movement-date" required>
                {t('date')}
              </Label>
              <Input id="movement-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {kind === 'dissolve' ? null : (
              <div className="space-y-1.5">
                <Label htmlFor="movement-amount" required>
                  {t('amount')}
                </Label>
                <Input id="movement-amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={formatAmount(0)} />
              </div>
            )}
          </div>
          {kind === 'dissolve' ? <p className="text-[13px] text-ink-2">{t('dissolveAmount', { amount: formatEuro(reserve.balanceCents) })}</p> : null}
          {showForYear ? (
            <div className="space-y-1.5">
              <Label htmlFor="movement-for-year">{t('forYear')}</Label>
              <Select id="movement-for-year" value={forYear} onChange={(e) => setForYear(e.target.value)}>
                {fiscalYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.designation}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <ResolutionField id="movement-resolution" document={document} onDocument={setDocument} onFile={setFile} />
          <div className="space-y-1.5">
            <Label htmlFor="movement-note">{t('note')}</Label>
            <Textarea id="movement-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {capProblem ? (
            <div data-testid="movement-cap-reason">
              <Notice level="warn" reason={{ name: 'movement-cap-reason', value: capReason, onChange: setCapReason, label: t('capReason') }}>
                {capProblem}
              </Notice>
            </div>
          ) : null}
          <p className="text-[13px] text-ink" aria-live="polite" data-testid="movement-after">
            {t('after', { amount: formatEuro(after) })}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void submit()} data-testid="movement-save">
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
