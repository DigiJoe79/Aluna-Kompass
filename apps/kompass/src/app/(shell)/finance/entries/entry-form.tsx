'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { EntryLinesInput } from '@kompass/module-finance';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import { AmountField } from '@/components/finance/amount-field';
import { BalanceIndicator } from '@/components/finance/balance-indicator';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { ReceiptList, type ReceiptListItem } from '@/components/finance/receipt-list';
import { SplitRow, type SplitRowCategoryOption, type SplitRowOption } from '@/components/finance/split-row';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { applyTemplate, remainderCents, restInto, toServiceInput, type EntryFormState, type EntryTemplate, type MoneyRow } from '@/lib/finance/entry-form';
import { remediesFor, type RemedyAction } from '@/lib/finance/remedies';
import { matchesDirection, suggestSettlementCents } from '@/lib/finance/settlement';
import { splitEvenly } from '@/lib/finance/split';
import { attachDocumentAction, finalizeAction, saveDraftAction, saveReviewedAction, uploadVoucherAction } from './actions';

const randomKey = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const emptySplitRow = () => ({ key: randomKey('split'), categoryId: '', amountText: '', contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false });

export interface EntryFormAccount {
  id: string;
  name: string;
  kind: 'bank' | 'cash' | 'paymentService';
  balanceCents: number;
}

/** Ein offener Posten, wie ihn die Suche „begleicht offene Zahlung“ an einer Geldzeile anbietet (Task 5). */
export interface EntryFormOpenItem {
  id: string;
  kind: 'receivable' | 'payable';
  label: string;
  openCents: number;
}

export interface EntryFormProps {
  initial: EntryFormState;
  accounts: EntryFormAccount[];
  categories: SplitRowCategoryOption[];
  purposes: SplitRowOption[];
  projects: SplitRowOption[];
  taxCodeOptions: string[];
  showTax: boolean;
  canFinalize: boolean;
  voucherTypeKey: string;
  vouchers: ReceiptListItem[];
  openItems: EntryFormOpenItem[];
  /** Wohin „Abbrechen“ und das Speichern eines Entwurfs führen — `/finance/work` aus der Arbeitsliste (F5). */
  returnTo?: string;
}

const TEMPLATES: EntryTemplate[] = ['income', 'expense', 'transfer', 'inKind'];

/**
 * Die offenen Zahlungen, die zur Richtung einer Geldzeile passen und noch
 * nicht an ihr hängen — Suche über Kontakt/Zahlungsreferenz, Restbetrag je
 * Treffer (Task 5).
 */
function MoneySettlements({
  row,
  rowIndex,
  openItems,
  fieldErrors,
  onChange,
}: {
  row: MoneyRow;
  rowIndex: number;
  openItems: EntryFormOpenItem[];
  fieldErrors: Record<string, string>;
  onChange: (settlements: MoneyRow['settlements']) => void;
}) {
  // Eigener Name statt `t`: Der Wächter `message-keys` liest Übersetzer-Namensräume je Datei, nicht je
  // Funktion — ein zweites `const t = …` in derselben Datei würde seine Bindung überschreiben.
  const ts = useTranslations('finance.entryForm.settlement');
  const tAmount = useTranslations('finance.amount');
  const [expanded, setExpanded] = useState(row.settlements.length > 0);
  const [query, setQuery] = useState('');

  const lineCents = parseAmount(row.amountText) ?? 0;
  const alreadySettled = row.settlements.reduce((sum, s) => sum + (parseAmount(s.amountText) ?? 0), 0);
  const chosenIds = new Set(row.settlements.map((s) => s.openItemId));
  const candidates = openItems
    .filter((item) => matchesDirection(item.kind, row.direction) && !chosenIds.has(item.id))
    .filter((item) => query.trim().length === 0 || item.label.toLowerCase().includes(query.trim().toLowerCase()));

  const add = (item: EntryFormOpenItem) => {
    const suggestion = suggestSettlementCents({ openCents: item.openCents, lineCents, alreadySettledCents: alreadySettled });
    onChange([...row.settlements, { openItemId: item.id, amountText: formatAmount(suggestion) }]);
  };
  const remove = (openItemId: string) => onChange(row.settlements.filter((s) => s.openItemId !== openItemId));
  const setAmountText = (openItemId: string, amountText: string) => onChange(row.settlements.map((s) => (s.openItemId === openItemId ? { ...s, amountText } : s)));

  return (
    <div className="space-y-2 border-t border-line pt-2">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="text-[13px] font-semibold text-ink-2 underline underline-offset-2">
        {ts('toggle')}
      </button>
      {expanded ? (
        <div className="space-y-2">
          {row.settlements.map((settlement, sIndex) => {
            const item = openItems.find((o) => o.id === settlement.openItemId);
            const errorCode = fieldErrors[`moneyRows.${rowIndex}.settlements.${sIndex}.amountText`];
            return (
              <div key={settlement.openItemId} className="flex items-center gap-2">
                <span className="flex-1 truncate text-[13px] text-ink-2">{item?.label ?? settlement.openItemId}</span>
                <div className="w-32">
                  <Label htmlFor={`settlement-${rowIndex}-${sIndex}`} className="sr-only">
                    {ts('amount')}
                  </Label>
                  <AmountField
                    id={`settlement-${rowIndex}-${sIndex}`}
                    name={`settlement-${rowIndex}-${sIndex}`}
                    value={settlement.amountText}
                    onChange={(text) => setAmountText(settlement.openItemId, text)}
                    invalid={!!errorCode}
                    errorText={errorCode ? tAmount(errorCode) : undefined}
                  />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(settlement.openItemId)}>
                  {ts('remove')}
                </Button>
              </div>
            );
          })}
          <Input placeholder={ts('searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {candidates.length > 0 ? (
            <ul className="space-y-1">
              {candidates.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => add(item)}
                    className="flex w-full items-center justify-between gap-2 rounded-sm border border-line px-2.5 py-1.5 text-left text-[13px]"
                  >
                    <span>{item.label}</span>
                    <span className="font-mono tabular-nums text-ink-2">{ts('rest', { amount: formatEuro(item.openCents) })}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-muted-ink">{ts('noMatches')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Die Buchungsmaske (HANDOFF § 5.1): Karten Kopf · Konto · Wofür? · Beleg, Fußleiste klebt. */
export function EntryForm({ initial, accounts, categories, purposes, projects, taxCodeOptions, showTax, canFinalize, voucherTypeKey, vouchers: initialVouchers, openItems, returnTo = '/finance/entries' }: EntryFormProps) {
  const t = useTranslations('finance.entryForm');
  // `remediesFor` liefert vollqualifizierte Schlüssel (`finance.remedy.*`) — ein eigener Übersetzer ohne Namensraum.
  const tRoot = useTranslations();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<EntryFormState>(initial);
  const [entryId, setEntryId] = useState<string | undefined>(initial.id);
  const [vouchers, setVouchers] = useState<ReceiptListItem[]>(initialVouchers);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [actionState, setActionState] = useState<ActionState>({ status: 'idle' });
  const dateRef = useRef<HTMLInputElement>(null);

  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const chosenAccount = state.moneyRows.length === 1 ? accountsById.get(state.moneyRows[0]!.accountId) : undefined;
  const isCash = chosenAccount?.kind === 'cash';
  // Eine Zeile, die einen Kontoumsatz bindet, hat Konto und Betrag aus der Bank — die Vorlage wechselt dann nicht mehr (F5).
  const bound = state.moneyRows.some((r) => !!r.rawTransactionId);

  const validation = toServiceInput(state);
  const remainder = remainderCents(state);

  // Festschreiben führt auf die Buchung (Task 4) — Entwurf speichern/prüfen bleibt im Journal.
  const afterSuccess = (result: ActionState, redirectTo: 'journal' | 'entry' = 'journal') => {
    setActionState(result);
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      const data = result.data as { id?: string } | undefined;
      router.push(redirectTo === 'entry' && data?.id ? `/finance/entries/${data.id}` : returnTo);
      router.refresh();
    } else if (result.status === 'error') {
      toast.error(result.message);
    }
  };

  const runAction = (run: (input: EntryLinesInput) => Promise<ActionState>) => {
    if (!validation.ok) {
      setActionState({ status: 'error', message: t('toast.fieldsInvalid'), fieldErrors: validation.fieldErrors });
      return;
    }
    startTransition(async () => afterSuccess(await run(validation.input), 'journal'));
  };

  // Diese Maske kennt nur ihre eigenen zwei Ausweg-Aktionen — `focusAccount`/`confirmFormatChange`
  // gehören zum Import (F4 Task 7) und laufen dort über ihre eigene Seite, nie hier.
  const applyRemedy = (action: RemedyAction) => {
    if (action === 'focusDate') {
      dateRef.current?.focus();
      return;
    }
    if (action !== 'restIntoLastRow') return;
    const lastRow = state.splitRows.at(-1);
    if (!lastRow) return;
    const next = restInto(state, lastRow.key);
    setState(next);
    const nextValidation = toServiceInput(next);
    if (!nextValidation.ok) {
      setActionState({ status: 'error', message: t('toast.fieldsInvalid'), fieldErrors: nextValidation.fieldErrors });
      return;
    }
    // „führt restInto aus und schickt erneut ab“ (Plan) — derselbe Weg wie „Festschreiben“.
    startTransition(async () => afterSuccess(await finalizeAction(nextValidation.input), 'entry'));
  };

  const ensureSavedId = async (): Promise<string | null> => {
    if (entryId) return entryId;
    if (!validation.ok) {
      setActionState({ status: 'error', message: t('toast.fieldsInvalid'), fieldErrors: validation.fieldErrors });
      return null;
    }
    const saved = await saveDraftAction(validation.input);
    if (saved.status !== 'success') {
      if (saved.status === 'error') toast.error(saved.message);
      return null;
    }
    const data = saved.data as { id: string; expectedVersion: string };
    setEntryId(data.id);
    setState((s) => ({ ...s, id: data.id, expectedVersion: data.expectedVersion }));
    return data.id;
  };

  const uploadFiles = async (files: File[]) => {
    const id = await ensureSavedId();
    if (!id) return;
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await uploadVoucherAction(id, voucherTypeKey, state.entryDate, file.name, bytes);
      if (result.status !== 'success') {
        if (result.status === 'error') toast.error(result.message);
        continue;
      }
      const data = result.data as { linkId: string; documentId: string; documentNumber: string };
      setVouchers((prev) => [...prev, { linkId: data.linkId, documentNumber: data.documentNumber, title: file.name, typeLabel: t('voucherType'), date: state.entryDate, viewHref: `/finance/entries/${id}/voucher/${data.documentId}`, revoked: false }]);
    }
  };

  const pickFromArchive = async (documentId: string) => {
    const id = await ensureSavedId();
    if (!id) return;
    const result = await attachDocumentAction(id, documentId);
    if (result.status === 'error') toast.error(result.message);
    else if (result.status === 'success') router.refresh();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!validation.ok) {
          setActionState({ status: 'error', message: t('toast.fieldsInvalid'), fieldErrors: validation.fieldErrors });
          return;
        }
        setConfirmFinalize(true);
      }}
      className="space-y-4"
    >
      <section className="space-y-3 rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <Label htmlFor="entry-date">{t('date')}</Label>
            <Input ref={dateRef} id="entry-date" type="date" value={state.entryDate} onChange={(e) => setState((s) => ({ ...s, entryDate: e.target.value }))} required />
          </div>
          <div className="min-w-[260px] flex-1 space-y-1">
            <Label htmlFor="entry-text">{t('text')}</Label>
            <Input id="entry-text" value={state.text} onChange={(e) => setState((s) => ({ ...s, text: e.target.value }))} required />
          </div>
        </div>
        <div role="radiogroup" aria-label={t('template')} className="flex flex-wrap gap-2">
          {TEMPLATES.map((template) => (
            <button
              key={template}
              type="button"
              role="radio"
              aria-checked={state.template === template}
              disabled={bound && state.template !== template}
              onClick={() => setState((s) => applyTemplate(s, template))}
              className={`h-[var(--field-h)] rounded-md border px-3 text-[13px] font-semibold ${state.template === template ? 'border-selected bg-selected text-selected-ink' : 'border-line-strong bg-surface-2 text-ink-2'}`}
            >
              {t(`templates.${template}`)}
            </button>
          ))}
        </div>
      </section>

      {state.template !== 'inKind' ? (
        <section data-testid="finance-account-card" className="space-y-3 rounded-md border border-line bg-surface p-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('accountCard')}</h3>
          {state.moneyRows.map((row, index) => (
            <div key={row.key} className="space-y-1.5">
              {row.rawTransactionId ? (
                <p data-testid="bound-money-line" className="rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[13px] tabular-nums text-ink">
                  {(() => {
                    const cents = (parseAmount(row.amountText) ?? 0) * (row.direction === 'out' ? -1 : 1);
                    return row.rawBookingDate ? t('boundLine', { date: row.rawBookingDate, amount: formatEuro(cents) }) : t('boundLineNoDate', { amount: formatEuro(cents) });
                  })()}
                </p>
              ) : null}
              <Label htmlFor={`account-${row.key}`}>{state.template === 'transfer' ? t(row.direction === 'out' ? 'transferFrom' : 'transferTo') : t('account')}</Label>
              <Select id={`account-${row.key}`} value={row.accountId} disabled={!!row.rawTransactionId} onChange={(e) => setState((s) => ({ ...s, moneyRows: s.moneyRows.map((r, i) => (i === index ? { ...r, accountId: e.target.value } : r)) }))} required>
                <option value="" disabled>
                  {t('accountPlaceholder')}
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
              <Label htmlFor={`amount-${row.key}`}>{t('amount')}</Label>
              <AmountField
                id={`amount-${row.key}`}
                name={`amount-${row.key}`}
                value={row.amountText}
                onChange={(amountText) => setState((s) => ({ ...s, moneyRows: s.moneyRows.map((r, i) => (i === index ? { ...r, amountText } : r)) }))}
                disabled={!!row.rawTransactionId}
                required
                balanceHint={accountsById.get(row.accountId) ? t('balanceHint', { amount: formatEuro(accountsById.get(row.accountId)!.balanceCents) }) : undefined}
              />
              <MoneySettlements
                row={row}
                rowIndex={index}
                openItems={openItems}
                fieldErrors={validation.ok ? {} : validation.fieldErrors}
                onChange={(settlements) => setState((s) => ({ ...s, moneyRows: s.moneyRows.map((r, i) => (i === index ? { ...r, settlements } : r)) }))}
              />
            </div>
          ))}
          {remainder !== null ? <BalanceIndicator open={remainder} /> : null}
        </section>
      ) : null}

      {state.template === 'transfer' ? (
        <p className="text-[13px] text-ink-2">{t('transferHint')}</p>
      ) : (
        <section data-testid="finance-allocation-card" className="space-y-3 rounded-md border border-line bg-surface p-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('allocationCard')}</h3>
          {state.splitRows.map((row) => {
            const withoutRow = { ...state, splitRows: state.splitRows.filter((r) => r.key !== row.key) };
            const restForRow = remainderCents(withoutRow);
            return (
              <SplitRow
                key={row.key}
                value={row}
                onChange={(next) =>
                  setState((s) => {
                    const updated = { ...s, splitRows: s.splitRows.map((r) => (r.key === row.key ? next : r)) };
                    // Sachspende: die zweite Zeile folgt der ersten mit dem negierten Betrag — `applyTemplate`
                    // zieht die Kopplung bei jeder Änderung nach (Kommentar in `entry-form.ts`).
                    return s.template === 'inKind' ? applyTemplate(updated, 'inKind') : updated;
                  })
                }
                onRemove={() => setState((s) => ({ ...s, splitRows: s.splitRows.filter((r) => r.key !== row.key) }))}
                onDuplicate={() => setState((s) => ({ ...s, splitRows: [...s.splitRows, { ...row, key: randomKey('split') }] }))}
                onRestHere={() => setState((s) => restInto(s, row.key))}
                onSplitEvenly={(n) =>
                  setState((s) => {
                    const totalCents = parseAmount(row.amountText) ?? 0;
                    const [first, ...rest] = splitEvenly(totalCents, n);
                    return {
                      ...s,
                      splitRows: [
                        ...s.splitRows.map((r) => (r.key === row.key ? { ...r, amountText: formatAmount(first ?? 0) } : r)),
                        ...rest.map((cents) => ({ ...row, key: randomKey('split'), amountText: formatAmount(cents) })),
                      ],
                    };
                  })
                }
                restCents={restForRow}
                categories={categories}
                purposes={purposes}
                projects={projects}
                taxCodeOptions={taxCodeOptions}
                showTax={showTax}
              />
            );
          })}
          {state.template !== 'inKind' ? (
            <Button type="button" variant="secondary" onClick={() => setState((s) => ({ ...s, splitRows: [...s.splitRows, emptySplitRow()] }))}>
              {t('addRow')}
            </Button>
          ) : null}
        </section>
      )}

      <section className="space-y-3 rounded-md border border-line bg-surface p-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('voucherCard')}</h3>
        <ReceiptDrop onFiles={(files) => void uploadFiles(files)} onPickFromArchive={() => setArchiveOpen(true)} />
        {archiveOpen ? <DocumentPicker id="voucher-archive" name="voucherArchive" label={t('pickFromArchive')} value={null} onChange={(doc) => doc && void pickFromArchive(doc.id)} /> : null}
        <ReceiptList items={vouchers} />
      </section>

      {actionState.status === 'error' && actionState.code ? (
        <Notice
          level="refuse"
          remedies={remediesFor(actionState.code).map((remedy) => ({
            label: tRoot(remedy.labelKey),
            ...(remedy.kind === 'action' ? { onSelect: () => applyRemedy(remedy.action) } : { href: remedy.href }),
          }))}
        >
          {actionState.detail ?? actionState.message}
        </Notice>
      ) : null}

      <FormActionBar
        back={{ href: returnTo, label: t('cancel') }}
        count={0}
        note={isCash ? t('cashNote') : undefined}
        extraActions={
          !isCash ? (
            <>
              <Button type="button" variant="secondary" onClick={() => runAction((input) => saveDraftAction(input))}>
                {t('actions.saveDraft')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => runAction((input) => saveReviewedAction(input))}>
                {t('actions.saveReviewed')}
              </Button>
            </>
          ) : null
        }
        saveLabel={t('actions.finalize')}
        saveDisabled={!canFinalize}
      />

      <ConfirmDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        title={t('confirmFinalize.title')}
        description={t('confirmFinalize.description')}
        confirmLabel={t('actions.finalize')}
        action={async () => {
          if (!validation.ok) return { status: 'error', message: t('toast.fieldsInvalid'), fieldErrors: validation.fieldErrors };
          const result = await finalizeAction(validation.input);
          afterSuccess(result, 'entry');
          return result;
        }}
      />
    </form>
  );
}
