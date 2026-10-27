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
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Overline } from '@/components/overline';
import { formatEuro, parseAmount } from '@/lib/finance/amount';
import { countResult, DENOMINATIONS_CENTS, sumDenominations } from '@/lib/finance/cash';
import { countCashAction, emptyDonationBoxAction } from './actions';
import { countCashForHandoverAction } from '../closing/handover/actions';
import { FixedValue } from '@/components/fixed-value';
import { useDateFormat } from '@/components/date-format-provider';
import { Section } from '@/components/section';

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
export function CountDialog({
  account,
  today,
  canCreateContact,
  witnesses = null,
  handover = null,
}: {
  account: CashAccountOption;
  today: string;
  canCreateContact: boolean;
  /** Die Prüfer der laufenden Kassenprüfung (Board 12f) — nur, wenn es welche gibt. */
  witnesses?: { designation: string; auditors: { id: string; name: string }[] } | null;
  /**
   * Amtsübergabe (Board 13e, Plan C2 Task 8): Datum fest auf dem Übergabetag, nur Kasse, „Zählt“ vorbelegt mit der
   * bisherigen Person, die zweite Zählende mit der neuen (Befund 4); wählt man dort jemand anderen, nennt
   * „Im Beisein von“ die neue; abgeschickt über `countCashForHandover`. Kasse und
   * Kassenprüfung rufen den Dialog ohne diesen Prop und bleiben, wie sie sind.
   */
  handover?: { id: string; handoverOn: string; from: PickedContact; to: PickedContact; triggerLabel: string; /** Primärknopf nur bei genau einer Kasse (14c); sonst `outline` je Zeile. */ primary?: boolean } | null;
}) {
  const t = useTranslations('finance.cash.count');
  const fmt = useDateFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'cash' | 'box'>('cash');
  const [boxLabel, setBoxLabel] = useState('');
  const [countedOn, setCountedOn] = useState(handover?.handoverOn ?? today);
  const [amountText, setAmountText] = useState('');
  const [useHelper, setUseHelper] = useState(false);
  const [pieces, setPieces] = useState<Record<number, number>>({});
  const [counterOne, setCounterOne] = useState<PickedContact | null>(handover?.from ?? null);
  // Amtsübergabe (Befund 4): die neue Person zählt als zweite mit, statt nur im Beisein dabei zu sein.
  const [counterTwo, setCounterTwo] = useState<PickedContact | null>(handover?.to ?? null);
  const [note, setNote] = useState('');
  const [witnessIds, setWitnessIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // 07-2 B21 (§ B): Speichern bleibt frei; was fehlt, steht am Feld (die fehlende Notiz bei Fehlbetrag nennt der Dienst).
  const [missing, setMissing] = useState<{ amount: boolean; box: boolean }>({ amount: false, box: false });
  const tFields = useTranslations('errors.fields');
  const feedback = useActionFeedback();

  const helperCents = useMemo(() => sumDenominations(pieces), [pieces]);
  const countedCents = useHelper ? helperCents : parseAmount(amountText);
  const bookCents = mode === 'cash' ? account.bookCents : 0;
  const preview = countedCents === null ? null : countResult(bookCents, countedCents);

  const close = () => {
    setOpen(false);
    setMode('cash');
    setBoxLabel('');
    setCountedOn(handover?.handoverOn ?? today);
    setAmountText('');
    setUseHelper(false);
    setPieces({});
    setCounterOne(handover?.from ?? null);
    setCounterTwo(handover?.to ?? null);
    setNote('');
    setWitnessIds([]);
    setFieldError(null);
    setMissing({ amount: false, box: false });
    feedback.reset();
  };

  const submit = async () => {
    const miss = { amount: countedCents === null, box: mode === 'box' && !boxLabel.trim() };
    setMissing(miss);
    if (!counterOne || !counterTwo) setFieldError(t('countersRequired'));
    if (countedCents === null || miss.box || !counterOne || !counterTwo) return;
    if (counterOne.id === counterTwo.id) {
      setFieldError(t('sameCounter'));
      return;
    }
    setPending(true);
    setFieldError(null);
    const result = await feedback.run(
      () =>
      handover
        ? countCashForHandoverAction({
            id: handover.id,
            accountId: account.id,
            countedCents,
            counterOneContactId: counterOne.id,
            counterTwoContactId: counterTwo.id,
            note: note.trim() || undefined,
            denominations: useHelper ? Object.fromEntries(Object.entries(pieces).filter(([, c]) => c > 0)) : undefined,
          })
        : mode === 'cash'
        ? countCashAction({
            accountId: account.id,
            countedOn,
            countedCents,
            counterOneContactId: counterOne.id,
            counterTwoContactId: counterTwo.id,
            note: note.trim() || undefined,
            denominations: useHelper ? Object.fromEntries(Object.entries(pieces).filter(([, c]) => c > 0)) : undefined,
            ...(witnessIds.length > 0 ? { witnessAuditorIds: witnessIds } : {}),
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
      {/* 07-2 B12: Die drei Kassenaktionen sind gleichrangig (`outline`). */}
      {handover ? (
        <Button type="button" variant={handover.primary === false ? 'outline' : 'default'} onClick={() => setOpen(true)} data-testid="handover-count">
          {handover.triggerLabel}
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          {t('trigger')}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent size="lg" className="bg-surface shadow-md">
          {/* Im Übergabe-Modus steht die Kasse fest: der Titel nennt sie und den Tag (287, 14c). */}
          <DialogTitle>{handover ? t('handoverTitle', { account: account.name, date: fmt.date(handover.handoverOn) }) : t('trigger')}</DialogTitle>
          <Section title={t('sections.what')}>
            <FormGrid>
              {handover ? null : (
              <FormCell size="s">
                <Segmented
                  aria-label={t('modeGroup')}
                  options={(['cash', 'box'] as const).map((m) => ({ value: m, label: t(`mode.${m}`) }))}
                  value={mode}
                  onValueChange={setMode}
                />
              </FormCell>
              )}
              {mode === 'box' ? (
                <FormField id="countBoxLabel" label={t('boxLabel')} required error={missing.box ? tFields('required') : undefined}>
                  <Input id="countBoxLabel" value={boxLabel} onChange={(e) => setBoxLabel(e.target.value)} required />
                </FormField>
              ) : null}
              <FormRowBreak />
              {handover ? (
                <FixedValue id="countedOn" label={t('date')} value={fmt.date(handover.handoverOn)} reason={t('handoverDate')} size="s" />
              ) : (
                <FormField id="countedOn" label={t('date')} size="s">
                  <Input id="countedOn" type="date" value={countedOn} max={today} onChange={(e) => setCountedOn(e.target.value)} />
                </FormField>
              )}
              {!useHelper ? (
                <FormField id="countedCents" label={t('countedAmount')} required size="s" error={missing.amount ? tFields('required') : undefined}>
                  <AmountField id="countedCents" name="countedCents" value={amountText} onChange={setAmountText} required />
                </FormField>
              ) : (
                <FormCell as="p" size="s" className="tabular-nums self-end text-meta">{formatEuro(helperCents)}</FormCell>
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
                          <label key={cents} className="flex items-center gap-1.5 text-hint">
                            <span className="w-16 shrink-0">{formatEuro(cents)}</span>
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
          </Section>

          <Section title={t('sections.who')}>
            <FormGrid>
              <FormCell size="m">
                <ContactPicker id="counter-one" name="counterOne" label={t('counterOne')} value={counterOne} onChange={setCounterOne} required kind="person" canCreate={canCreateContact} />
              </FormCell>
              <FormCell size="m">
                <ContactPicker id="counter-two" name="counterTwo" label={t('counterTwo')} value={counterTwo} onChange={setCounterTwo} required kind="person" canCreate={canCreateContact} />
              </FormCell>
            </FormGrid>
            <FieldError id="count-counters-error" message={fieldError ?? undefined} />
            {handover && counterOne?.id !== handover.to.id && counterTwo?.id !== handover.to.id ? (
              <div className="mt-4" data-testid="count-handover-witness">
                <FixedValue id="count-handover-witness" label={t('witnesses')} value={handover.to.name} reason={t('handoverWitness')} size="m" />
              </div>
            ) : null}
            {mode === 'cash' && witnesses && witnesses.auditors.length > 0 ? (
              // Ein Feld reicht (Board 12f): Kästchen für die Prüfer des Jahres, das gerade geprüft wird — kein eigenes Datum.
              <fieldset className="mt-4 flex flex-col gap-2" aria-describedby="count-witnesses-hint" data-testid="count-witnesses">
                <legend>
                  <Overline as="span" field>
                    {t('witnesses')}
                  </Overline>
                </legend>
                {witnesses.auditors.map((a) => (
                  <span key={a.id} className="flex items-center gap-2">
                    <Checkbox id={`count-witness-${a.id}`} checked={witnessIds.includes(a.id)} onCheckedChange={(on) => setWitnessIds((ids) => (on ? [...ids, a.id] : ids.filter((id) => id !== a.id)))} />
                    <Label htmlFor={`count-witness-${a.id}`} className="font-normal">
                      {a.name}
                    </Label>
                  </span>
                ))}
                <p id="count-witnesses-hint" className="text-hint text-muted-ink">
                  {t('witnessesHint', { year: witnesses.designation })}
                </p>
              </fieldset>
            ) : null}
          </Section>

          {mode === 'cash' && preview ? (
            <p aria-live="polite" className="text-meta">
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
            saveLabel={t('submit')}
            onSave={() => void submit()}
            state={feedback.state}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
