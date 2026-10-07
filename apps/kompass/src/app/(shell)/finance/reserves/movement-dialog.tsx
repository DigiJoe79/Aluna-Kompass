'use client';

import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { Notice } from '@/components/notice';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { reserveBalanceAfter, type ReserveMovementKind } from '@/lib/finance/reserves';
import { recordReserveMovementAction, recordReserveMovementUploadAction } from './actions';
import { ResolutionField } from './resolution-field';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';

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
  const feedback = useActionFeedback();
  // Befund S: über dem Höchstbetrag der freien Rücklage fragt der Dienst nach einer Begründung — kein Verbot.
  const [capProblem, setCapProblem] = useState<string | null>(null);
  const [capReason, setCapReason] = useState('');

  const amountCents = kind === 'dissolve' || amountText.trim() === '' ? null : parseAmount(amountText);
  const showForYear = kind === 'allocate' && reserve.kind === 'free';
  const canSave = !!date && (kind === 'dissolve' || (amountCents !== null && amountCents > 0)) && !!document !== !!file;
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
    const base = {
      reserveId: reserve.id,
      kind,
      movementDate: date,
      amountCents: kind === 'dissolve' ? undefined : amountCents ?? undefined,
      forFiscalYearId: showForYear && forYear ? forYear : undefined,
      note: note.trim() || null,
      ...(capReason.trim() ? { capReason: capReason.trim() } : {}),
    };
    const call = (): Promise<ActionState> => {
      if (!file) return recordReserveMovementAction({ ...base, resolutionDocumentId: document!.id });
      const formData = new FormData();
      formData.append('reserveId', base.reserveId);
      formData.append('kind', base.kind);
      formData.append('movementDate', base.movementDate);
      if (base.amountCents !== undefined) formData.append('amountCents', String(base.amountCents));
      if (base.forFiscalYearId) formData.append('forFiscalYearId', base.forFiscalYearId);
      if (base.note) formData.append('note', base.note);
      if (base.capReason) formData.append('capReason', base.capReason);
      formData.append('file', file);
      return recordReserveMovementUploadAction(formData);
    };
    const result = await feedback.run(call, { retry: () => void submit() });
    setPending(false);
    if (result.status === 'error') {
      if (result.code === 'freeReserveCapExceeded') {
        feedback.reset();
        setCapProblem(result.detail ?? result.message);
      }
      return;
    }
    if (result.status === 'success') onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* fixed-footer: in `md` stehen die Felder untereinander, mit Beschluss und Begründung wird der Dialog höher als mancher Bildschirm — die Mitte scrollt, Kopf und Leiste stehen. */}
      <DialogContent size="md" layout="fixed-footer" className="bg-surface shadow-md">
        <DialogHeader>
          <DialogTitle>{t('title', { name: reserve.name })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-3.5" data-testid="movement-dialog">
            <FormGrid>
              {/* Sichtbares Label wie bei FormField (Entscheidung zum Inventar § E); die Leiste ist kein einzelnes Eingabefeld. */}
              <FormCell size="m" className="flex flex-col gap-1.5">
                <span id="movement-kind-label" className="text-[13px] font-semibold text-ink-2">{t('kindLabel')}</span>
                <div role="radiogroup" aria-labelledby="movement-kind-label" className="flex gap-1 rounded-md border border-line bg-surface-2 p-1" onKeyDown={onSegmentKey}>
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      tabIndex={kind === k ? 0 : -1}
                      data-testid={`movement-kind-${k}`}
                      onClick={() => setKind(k)}
                      className={`flex-1 rounded-sm px-2 py-1.5 text-[13px] font-semibold ${kind === k ? 'bg-surface text-ink shadow-sm' : 'text-ink-2'}`}
                    >
                      {t(`kinds.${k}`)}
                    </button>
                  ))}
                </div>
              </FormCell>
              <FormField id="movement-date" label={t('date')} required size="s">
                <Input id="movement-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </FormField>
              {kind === 'dissolve' ? null : (
                <FormField id="movement-amount" label={t('amount')} required size="s">
                  <Input id="movement-amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={formatAmount(0)} />
                </FormField>
              )}
              {showForYear ? (
                <FormField id="movement-for-year" label={t('forYear')} size="s">
                  <Select id="movement-for-year" value={forYear} onChange={(e) => setForYear(e.target.value)}>
                    {fiscalYears.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.designation}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              {kind === 'dissolve' ? <FormCell as="p" size="full" className="text-[13px] text-ink-2">{t('dissolveAmount', { amount: formatEuro(reserve.balanceCents) })}</FormCell> : null}
              <FormCell size="full">
                <ResolutionField id="movement-resolution" document={document} onDocument={setDocument} onFile={setFile} />
              </FormCell>
              <FormField id="movement-note" label={t('note')} size="l">
                <Textarea id="movement-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            </FormGrid>
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
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!canSave} saveLabel={t('save')} saveTestId="movement-save" onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
