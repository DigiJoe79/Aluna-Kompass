'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { AmountField } from '@/components/finance/amount-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { Empty } from '@/components/empty-value';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { runAction, toastUndo } from '@/lib/feedback';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { assignAmountProblem, assignCap, firstSelectable, oldestDueFirst } from '@/lib/finance/assign-payment';
import { assignablePaymentsAction, assignPaymentAction, unassignPaymentAction, type AssignCandidateRow, type AssignDialogData } from './actions';

export interface AssignResult {
  openItemId: string;
  unfoundedNotice: boolean;
}

/**
 * „Zahlung zuordnen“ (Spec Zahlung zuordnen § 3.5, Design 1a–3c, HANDOFF „Bausteine je Stelle“): oben der Posten als
 * feste Werte — aus dem Mahnlauf mit mehreren Beiträgen die Wahl des Beitrags (`RadioGroup` mit Beschreibungszeile) —,
 * darunter die Zahlungen des Kontakts als `ui/table` mit `RadioGroupItem` am Platz `select`. Gesperrte Zeilen sind
 * nicht wählbar und nennen Grund und Ausweg in der Zeile. Ablehnungen des Dienstes stehen im Fuß, Dialog und Wahl
 * bleiben. Nach dem Zuordnen schließt der Dialog mit `toastUndo` — aus dem Mahnlauf bleibt er offen, solange noch ein
 * Beitrag und freies Geld da sind.
 */
export function AssignPaymentDialog({
  openItemIds,
  open,
  onOpenChange,
  onAssigned,
  today,
  fromDunning,
  itemNotes,
}: {
  openItemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned?: (result: AssignResult) => void;
  today: string;
  /** Aus dem Mahnlauf: Name und Nummer des Mitglieds für die Unterzeile des Titels. */
  fromDunning?: { name: string; number: string };
  /** Zusatz zur Beschreibungszeile je Beitrag (Mahnstufe), nach Posten. */
  itemNotes?: Record<string, string>;
}) {
  const t = useTranslations('finance.openItems.assign');
  const td = useTranslations('finance.openItems.detail');
  const c = useTranslations('common');
  const { date } = useDateFormat();
  const [data, setData] = useState<AssignDialogData[] | null>(null);
  const [loadError, setLoadError] = useState<ActionState | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [state, setState] = useState<ActionState | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const idsKey = openItemIds.join(',');

  const choose = useCallback((loaded: AssignDialogData[], preferItem?: string | null) => {
    const order = oldestDueFirst(loaded.map((d) => ({ ...d.item })), today).map((i) => i.id);
    const withMoney = order.filter((id) => loaded.find((d) => d.item.id === id)!.item.openCents > 0);
    const nextItem = preferItem && withMoney.includes(preferItem) ? preferItem : (withMoney[0] ?? order[0] ?? null);
    setItemId(nextItem);
    const current = loaded.find((d) => d.item.id === nextItem);
    const first = current ? firstSelectable(current.candidates) : null;
    setLineId(first?.moneyLineId ?? null);
    setAmountText(current && first ? formatAmount(assignCap(current.item.openCents, first.freeCents)) : '');
    setAmountError(null);
  }, [today]);

  const load = useCallback(async (preferItem?: string | null): Promise<AssignDialogData[] | null> => {
    const results = await Promise.all(idsKey.split(',').map((id) => assignablePaymentsAction(id)));
    const failed = results.find((r) => r.status === 'error');
    if (failed) {
      setLoadError(failed);
      return null;
    }
    const loaded = results.map((r) => (r as { data: AssignDialogData }).data);
    setLoadError(null);
    setData(loaded);
    choose(loaded, preferItem);
    return loaded;
  }, [idsKey, choose]);

  useEffect(() => {
    if (!open) return;
    setState(undefined);
    void load();
  }, [open, load]);

  // Fokus nach dem Laden auf die Liste: auf die gewählte Zeile, sonst die erste.
  useEffect(() => {
    if (!open || !data) return;
    const radio = listRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? listRef.current?.querySelector<HTMLElement>('[role="radio"]:not([aria-disabled="true"])');
    radio?.focus();
  }, [open, data, itemId]);

  const current = data?.find((d) => d.item.id === itemId) ?? null;
  const candidate = current?.candidates.find((x) => x.moneyLineId === lineId) ?? null;
  const cap = current && candidate ? assignCap(current.item.openCents, candidate.freeCents) : 0;
  const amountCents = parseAmount(amountText);

  const pickLine = (id: string) => {
    const next = current?.candidates.find((x) => x.moneyLineId === id && x.blockedBy === null);
    if (!next || !current) return;
    setLineId(id);
    setAmountText(formatAmount(assignCap(current.item.openCents, next.freeCents)));
    setAmountError(null);
    setState(undefined);
  };

  const submit = async () => {
    if (!current || !candidate) return;
    const problem = assignAmountProblem(amountText, cap);
    if (problem) {
      setAmountError(t('amount.tooHigh', { max: formatEuro(cap) }));
      return;
    }
    setPending(true);
    const result = await runAction(() => assignPaymentAction({ openItemId: current.item.id, moneyLineId: candidate.moneyLineId, amountCents: amountCents! }), c('network'));
    setPending(false);
    if (result.status !== 'success') {
      setState(result);
      return;
    }
    const done = result.data as { openItemId: string; unfoundedNotice: boolean; settlementId: string | null };
    const number = candidate.entryNumber ?? '';
    toastUndo(t('toast.assigned', { number }), () => (done.settlementId ? unassignPaymentAction(done.settlementId) : Promise.resolve({ status: 'idle' } as ActionState)), { undo: c('undo'), network: c('network') });
    onAssigned?.({ openItemId: done.openItemId, unfoundedNotice: done.unfoundedNotice });
    if (openItemIds.length > 1) {
      const reloaded = await load(null);
      const more = reloaded?.some((d) => d.item.openCents > 0 && d.candidates.some((x) => x.blockedBy === null));
      if (more) return;
    }
    onOpenChange(false);
  };

  const guardians = current?.candidates.some((x) => x.viaGuardian) ?? false;
  const name = current?.item.contactLabel ?? '';
  const draftHint = current && current.item.draftSettlementCents > 0;
  const subline = fromDunning ? t('fromDunning', fromDunning) : (current?.item.paymentReference ?? '');
  const remaining = data?.filter((d) => d.item.id !== itemId && d.item.openCents > 0) ?? [];

  const amountHelp = (() => {
    if (!current || !candidate || amountCents === null) return undefined;
    const rest = current.item.openCents - amountCents;
    const free = candidate.freeCents - amountCents;
    if (rest > 0) return t('amount.partial', { rest: formatEuro(rest) });
    if (free > 0) return t('amount.over', { rest: formatEuro(free) });
    return t('amount.help', { open: formatEuro(current.item.openCents), free: formatEuro(candidate.freeCents) });
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" layout="fixed-footer" data-testid="assign-payment-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          {subline ? <DialogDescription>{subline}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>
          {loadError?.status === 'error' ? <Notice level="refuse">{loadError.message}</Notice> : null}
          {current ? (
            <div className="flex flex-col gap-4">
              {draftHint ? <Notice level="hint">{t('draft', { amount: formatEuro(current.item.draftSettlementCents) })}</Notice> : null}
              {data && data.length > 1 ? (
                <div className="flex flex-col gap-2">
                  <Overline field>{t('choose.label')}</Overline>
                  <RadioGroup aria-label={t('choose.label')} value={itemId ?? ''} onValueChange={(v) => choose(data, v as string)} data-testid="assign-choose-item">
                    {oldestDueFirst(data.map((d) => d.item), today).map((i) => (
                      <label key={i.id} className="flex items-start gap-2 text-body text-ink">
                        <RadioGroupItem value={i.id} className="mt-0.5" />
                        <span className="flex flex-col">
                          <span>{t('choose.option', { reference: i.paymentReference ?? '', amount: formatEuro(i.openCents) })}</span>
                          <span className="text-meta text-muted-ink">
                            {i.dueOn ? t('choose.optionMeta', { dueOn: date(i.dueOn) }) : <Empty />}
                            {itemNotes?.[i.id] ? ` · ${itemNotes[i.id]}` : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                  <p className="text-meta text-muted-ink">{t('choose.hint')}</p>
                </div>
              ) : (
                <dl className="flex flex-wrap gap-x-6 gap-y-3 rounded-lg bg-surface-2 p-4 text-meta" data-testid="assign-head">
                  <div>
                    <dt className="text-muted-ink">{t('head.contact')}</dt>
                    <dd className="text-ink">{name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-ink">{t('head.reference')}</dt>
                    <dd className="text-ink">{current.item.paymentReference ?? <Empty />}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-ink">{t('head.open')}</dt>
                    <dd className="tabular-nums text-ink">{t('head.openOf', { open: formatEuro(current.item.openCents), amount: formatEuro(current.item.amountCents) })}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-ink">{t('head.dueOn')}</dt>
                    <dd className="text-ink">{current.item.dueOn ? date(current.item.dueOn) : <Empty />}</dd>
                  </div>
                </dl>
              )}

              {current.candidates.length === 0 ? (
                <EmptyState
                  title={t('empty.title', { name })}
                  text={t('empty.text')}
                  action={
                    <Link href={`/finance/entries/new?template=income&settles=${current.item.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                      {td('bookNow')}
                    </Link>
                  }
                />
              ) : (
                <div ref={listRef} className="flex flex-col gap-2">
                  <Overline field>{guardians ? t('listTitleGuardians', { name }) : t('listTitle', { name })}</Overline>
                  <RadioGroup aria-label={guardians ? t('listTitleGuardians', { name }) : t('listTitle', { name })} value={lineId ?? ''} onValueChange={(v) => pickLine(v as string)}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead col="select">
                            <span className="sr-only">{t('columns.pick')}</span>
                          </TableHead>
                          <TableHead col="title">{t('columns.category')}</TableHead>
                          <TableHead col="amount">{t('columns.free')}</TableHead>
                          <TableHead col="meta">{t('columns.date')}</TableHead>
                          <TableHead col="meta">{t('columns.number')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {current.candidates.map((x) => (
                          <CandidateRow key={x.moneyLineId} candidate={x} />
                        ))}
                      </TableBody>
                    </Table>
                  </RadioGroup>
                </div>
              )}

              {candidate ? (
                <FormField id="assign-amount" label={t('amount.label')} required hint={amountError ? undefined : amountHelp} error={amountError ?? undefined}>
                  <AmountField name="assign-amount" id="assign-amount" value={amountText} onChange={(v) => { setAmountText(v); setAmountError(null); }} invalid={!!amountError} required />
                </FormField>
              ) : null}
            </div>
          ) : null}
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          state={state}
          onSave={() => void submit()}
          pending={pending}
          saveLabel={t('save')}
          saveDisabled={!candidate}
          cancel={() => onOpenChange(false)}
          note={<span className="text-meta text-muted-ink">{fromDunning && remaining.length > 0 ? t('footNoteDunning', { fee: remaining[0]!.item.paymentReference ?? '' }) : t('footNote')}</span>}
          saveTestId="assign-payment-save"
        />
      </DialogContent>
    </Dialog>
  );
}

/** Eine Zahlung in der Liste: Kategorie vorn, darunter Buchungstext, Verwendungszweck, Zahler, Hinweis und Sperre (`meta wrap`). */
function CandidateRow({ candidate: x }: { candidate: AssignCandidateRow }) {
  const t = useTranslations('finance.openItems.assign');
  const { date } = useDateFormat();
  const blocked = x.blockedBy !== null;
  const dim = blocked ? 'text-muted-ink' : 'text-ink';
  return (
    <TableRow data-testid="assign-candidate" data-blocked={blocked ? '' : undefined}>
      <TableCell col="select">
        <RadioGroupItem value={x.moneyLineId} disabled={blocked} aria-label={`${x.categoryLabel} ${formatEuro(x.freeCents)} ${x.entryNumber ?? ''}`} />
      </TableCell>
      <TableCell col="title">
        <span className={dim}>{x.categoryLabel}</span>
        <p className={`text-meta ${dim}`}>{x.entryText}</p>
        {x.purpose ? <p className={`text-meta ${dim}`}>{t('purpose', { purpose: x.purpose })}</p> : null}
        {x.viaGuardian ? <p className="text-meta text-muted-ink">{t('viaGuardian', { name: x.payerName })}</p> : null}
        {x.assignedToLabels.length > 0 ? <p className="text-meta text-muted-ink">{t('partlyAssigned', { free: formatEuro(x.freeCents), line: formatEuro(x.lineCents), assigned: x.assignedToLabels.join(', ') })}</p> : null}
        {x.purposeHint && !blocked ? (
          <Notice level="hint">{x.purposeHint.kind === 'otherYear' ? t('hint.otherYear', { year: x.purposeHint.year }) : t('hint.otherItem', { reference: x.purposeHint.paymentReference })}</Notice>
        ) : null}
        {x.blockedText ? (
          <p className="text-meta text-ink" data-testid="assign-blocked-reason">
            {x.blockedText}{' '}
            {x.blockedLink ? (
              <Link href={x.blockedLink.href} className="text-link underline">
                {x.blockedLink.kind === 'rebook' ? t('blocked.rebook') : t('blocked.reopen')}
              </Link>
            ) : null}
          </p>
        ) : null}
      </TableCell>
      <TableCell col="amount">
        <span className={`tabular-nums ${dim}`}>{formatEuro(x.freeCents)}</span>
      </TableCell>
      <TableCell col="meta">{date(x.entryDate)}</TableCell>
      <TableCell col="meta">
        <Link href={`/finance/entries/${x.entryId}`} target="_blank" className="font-mono text-link underline">
          {x.entryNumber ?? ''}
        </Link>{' '}
        <span className="text-muted-ink">{x.accountName}</span>
      </TableCell>
    </TableRow>
  );
}
