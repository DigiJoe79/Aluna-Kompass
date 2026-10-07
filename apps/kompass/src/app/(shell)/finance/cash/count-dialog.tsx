'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FieldError } from '@/components/forms/field-error';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid, FormRowBreak } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { countResult, DENOMINATIONS_CENTS, sumDenominations } from '@/lib/finance/cash';
import { countCashAction, emptyDonationBoxAction } from './actions';

export interface CashAccountOption {
  id: string;
  name: string;
  bookCents: number;
}

/**
 * „Kasse oder Dose gezählt“ (HANDOFF § 5.4, Task 2): ein Dialog für beide
 * Wege — eine Kasse zählt `countCashAction` (Tatsache + Protokoll +
 * Differenzbuchung), eine Dose zählt `emptyDonationBoxAction` (Einnahme ohne
 * Kontakt). Das Konto steht schon fest (Auswahl auf der Seite, HANDOFF § 5.4);
 * der Aufrufer setzt `key={account.id}`, damit ein Kontowechsel den Dialog neu
 * montiert statt einen veralteten Buchbestand mitzuschleppen.
 */
export function CountDialog({ account, today, canCreateContact }: { account: CashAccountOption; today: string; canCreateContact: boolean }) {
  const t = useTranslations('finance.cash.count');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'cash' | 'box'>('cash');
  const [boxLabel, setBoxLabel] = useState('');
  const [countedOn, setCountedOn] = useState(today);
  const [amountText, setAmountText] = useState('');
  const [useHelper, setUseHelper] = useState(false);
  const [pieces, setPieces] = useState<Record<number, number>>({});
  const [counterOne, setCounterOne] = useState<PickedContact | null>(null);
  const [counterTwo, setCounterTwo] = useState<PickedContact | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const feedback = useActionFeedback();

  const helperCents = useMemo(() => sumDenominations(pieces), [pieces]);
  const countedCents = useHelper ? helperCents : parseAmount(amountText);
  const bookCents = mode === 'cash' ? account.bookCents : 0;
  const preview = countedCents === null ? null : countResult(bookCents, countedCents);

  const close = () => {
    setOpen(false);
    setMode('cash');
    setBoxLabel('');
    setCountedOn(today);
    setAmountText('');
    setUseHelper(false);
    setPieces({});
    setCounterOne(null);
    setCounterTwo(null);
    setNote('');
    setFieldError(null);
    feedback.reset();
  };

  const submit = async () => {
    if (countedCents === null || !counterOne || !counterTwo) return;
    if (counterOne.id === counterTwo.id) {
      setFieldError(t('sameCounter'));
      return;
    }
    setPending(true);
    setFieldError(null);
    const result = await feedback.run(
      () =>
      mode === 'cash'
        ? countCashAction({
            accountId: account.id,
            countedOn,
            countedCents,
            counterOneContactId: counterOne.id,
            counterTwoContactId: counterTwo.id,
            note: note.trim() || undefined,
            denominations: useHelper ? Object.fromEntries(Object.entries(pieces).filter(([, c]) => c > 0)) : undefined,
          })
        : emptyDonationBoxAction({
            accountId: account.id,
            date: countedOn,
            amountCents: countedCents,
            counterOneContactId: counterOne.id,
            counterTwoContactId: counterTwo.id,
            boxLabel: boxLabel.trim(),
          }),
      { retry: () => void submit() },
    );
    setPending(false);
    if (result.status === 'success') {
      close();
      router.refresh();
    }
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t('trigger')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent size="lg" className="bg-surface shadow-md">
          <DialogTitle>{t('trigger')}</DialogTitle>
          <section>
            <h3 className="text-[15px] font-semibold">{t('sections.what')}</h3>
            <div className="mt-3">
              <FormGrid>
                <FormCell size="s">
                  <div role="group" aria-label={t('modeGroup')} className="inline-flex h-[var(--field-h)] overflow-hidden rounded-md border border-line-strong">
                    {(['cash', 'box'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={mode === m}
                        onClick={() => setMode(m)}
                        className={mode === m ? 'bg-selected px-3 text-[13px] font-semibold text-selected-ink' : 'bg-surface-2 px-3 text-[13px] text-ink-2'}
                      >
                        {t(`mode.${m}`)}
                      </button>
                    ))}
                  </div>
                </FormCell>
                {mode === 'box' ? (
                  <FormField id="countBoxLabel" label={t('boxLabel')} required>
                    <Input id="countBoxLabel" value={boxLabel} onChange={(e) => setBoxLabel(e.target.value)} required />
                  </FormField>
                ) : null}
                <FormRowBreak />
                <FormField id="countedOn" label={t('date')} size="s">
                  <Input id="countedOn" type="date" value={countedOn} max={today} onChange={(e) => setCountedOn(e.target.value)} />
                </FormField>
                {!useHelper ? (
                  <FormField id="countedCents" label={t('countedAmount')} required size="s">
                    <AmountField id="countedCents" name="countedCents" value={amountText} onChange={setAmountText} required />
                  </FormField>
                ) : (
                  <FormCell as="p" size="s" className="self-end text-[13px] font-mono">{formatEuro(helperCents)}</FormCell>
                )}
                {mode === 'cash' ? (
                  <FormCell size="full">
                    <Disclosure label={t('helper.title')} defaultOpen={useHelper}>
                      <FormField id="countHelper" label={t('helper.use')} toggle className="mb-2">
                        <Checkbox id="countHelper" checked={useHelper} onCheckedChange={(next) => setUseHelper(next === true)} />
                      </FormField>
                      {useHelper ? (
                        // Die Zählhilfe hat ihr eigenes Unterraster für die Stückelungen (Entscheidung zum Inventar).
                        <div className="grid grid-cols-3 gap-2">
                          {DENOMINATIONS_CENTS.map((cents) => (
                            <label key={cents} className="flex items-center gap-1.5 text-[12px]">
                              <span className="w-16 shrink-0">{formatAmount(cents)} €</span>
                              <Input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                data-testid={`denomination-${cents}`}
                                value={pieces[cents] ?? ''}
                                onChange={(e) => setPieces((prev) => ({ ...prev, [cents]: Number(e.target.value) || 0 }))}
                                className="text-right"
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </Disclosure>
                  </FormCell>
                ) : null}
              </FormGrid>
            </div>
          </section>

          <section className="border-t border-line pt-5">
            <h3 className="text-[15px] font-semibold">{t('sections.who')}</h3>
            <div className="mt-3">
              <FormGrid>
                <FormCell size="m">
                  <ContactPicker id="counter-one" name="counterOne" label={t('counterOne')} value={counterOne} onChange={setCounterOne} required kind="person" canCreate={canCreateContact} />
                </FormCell>
                <FormCell size="m">
                  <ContactPicker id="counter-two" name="counterTwo" label={t('counterTwo')} value={counterTwo} onChange={setCounterTwo} required kind="person" canCreate={canCreateContact} />
                </FormCell>
              </FormGrid>
              <FieldError id="count-counters-error" message={fieldError ?? undefined} />
            </div>
          </section>

          {mode === 'cash' && preview ? (
            <p aria-live="polite" className="text-[13px]">
              {t('resultLine', { book: formatEuro(bookCents), counted: formatEuro(countedCents ?? 0) })}
              {preview.kind !== 'equal' ? <strong> · {t(`kind.${preview.kind}`)} {formatEuro(Math.abs(preview.differenceCents))}</strong> : null}
            </p>
          ) : null}

          {mode === 'cash' && preview?.kind === 'shortage' ? (
            <Notice level="warn" reason={{ name: 'note', value: note, onChange: setNote, label: t('noteLabel') }}>
              {t('shortageHint')}
            </Notice>
          ) : null}
          <FormActionBar
            placement="dialog"
            cancel={close}
            pending={pending}
            saveDisabled={countedCents === null || !counterOne || !counterTwo || (mode === 'box' && !boxLabel.trim()) || (mode === 'cash' && preview?.kind === 'shortage' && !note.trim())}
            saveLabel={t('submit')}
            onSave={() => void submit()}
            state={feedback.state}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
