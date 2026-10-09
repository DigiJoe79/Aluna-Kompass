'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { EntryLinesInput } from '@kompass/module-finance';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { BalanceIndicator } from '@/components/finance/balance-indicator';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { ReceiptList, type ReceiptListItem } from '@/components/finance/receipt-list';
import { SplitRow, type SplitRowCategoryOption, type SplitRowOption } from '@/components/finance/split-row';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Notice } from '@/components/notice';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { applyTemplate, countEntryChanges, remainderCents, restInto, toServiceInput, type EntryFormState, type EntryTemplate, type MoneyRow } from '@/lib/finance/entry-form';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { runAction as guarded, toastNetwork, toastRefusal } from '@/lib/feedback';
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
  /** `?voucher=` („Zu Buchung machen“, F5): ein Beleg der Akte, der nach dem ersten Speichern verknüpft wird. */
  pendingVoucher?: PendingVoucher | null;
  /** „Heute“ in der Zeitzone des Vereins, vom Server (Befund 47) — der Browser kennt nur seinen UTC-Tag. */
  today: string;
}

export interface PendingVoucher {
  documentId: string;
  number: string | null;
  subject: string;
  typeLabel: string;
  date: string;
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
      <Button type="button" variant="link" className="h-auto p-0" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        {ts('toggle')}
      </Button>
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
/** Befund AH und Q: Konflikte, die eine Begründung verlangen statt zu sperren. */
const REASON_CODES = new Set(['boardAllowanceNeedsReason', 'purposeGoesNegative']);

export function EntryForm({ initial, accounts, categories, purposes, projects, taxCodeOptions, showTax, canFinalize, voucherTypeKey, vouchers: initialVouchers, openItems, returnTo = '/finance/entries', pendingVoucher: initialPending = null, today }: EntryFormProps) {
  const t = useTranslations('finance.entryForm');
  // `remediesFor` liefert vollqualifizierte Schlüssel (`finance.remedy.*`) — ein eigener Übersetzer ohne Namensraum.
  const tRoot = useTranslations();
  const { date } = useDateFormat();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<EntryFormState>(initial);
  // Der zuletzt gesicherte Stand: beim Laden, nach dem automatischen Entwurf für einen Beleg wieder neu.
  const [saved, setSaved] = useState<EntryFormState>(initial);
  const [entryId, setEntryId] = useState<string | undefined>(initial.id);
  const [vouchers, setVouchers] = useState<ReceiptListItem[]>(initialVouchers);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pendingVoucher, setPendingVoucher] = useState<PendingVoucher | null>(initialPending);
  const [actionState, setActionState] = useState<ActionState>({ status: 'idle' });
  // Belege hochladen oder aus der Akte holen: Die Ablehnung steht über der Ablage.
  const [voucherRefusal, setVoucherRefusal] = useState<ActionState>({ status: 'idle' });
  const dateRef = useRef<HTMLInputElement>(null);

  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const chosenAccount = state.moneyRows.length === 1 ? accountsById.get(state.moneyRows[0]!.accountId) : undefined;
  const isCash = chosenAccount?.kind === 'cash';
  // Eine Zeile, die einen Kontoumsatz bindet, hat Konto und Betrag aus der Bank — die Vorlage wechselt dann nicht mehr (F5).
  const bound = state.moneyRows.some((r) => !!r.rawTransactionId);

  const validation = toServiceInput(state);
  const remainder = remainderCents(state);

  // Festschreiben führt auf die Buchung (Task 4) — Entwurf speichern/prüfen bleibt im Journal.
  /** Der Beleg aus `?voucher=` hängt sich an, sobald die Buchung eine ID hat — einmal. */
  const attachPending = async (id: string) => {
    if (!pendingVoucher) return;
    const attached = await attachDocumentAction(id, pendingVoucher.documentId);
    // Die Seite wechselt gleich: Der Entwurf steht, der Beleg hängt nicht — kein Platz über einem Knopf, deshalb ein Toast.
    if (attached.status === 'error') toastRefusal(attached);
    else setPendingVoucher(null);
  };

  const afterSuccess = async (result: ActionState, redirectTo: 'journal' | 'entry' = 'journal') => {
    setActionState(result);
    if (result.status === 'success') {
      const saved = result.data as { id?: string } | undefined;
      if (saved?.id) await attachPending(saved.id);
      if (result.message) toast.success(result.message);
      const data = result.data as { id?: string } | undefined;
      router.push(redirectTo === 'entry' && data?.id ? `/finance/entries/${data.id}` : returnTo);
      router.refresh();
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
    const saved = await guarded(() => saveDraftAction(validation.input), tRoot('common.network'));
    if (saved.status !== 'success') {
      if (saved.status === 'error') {
        if (saved.kind === 'network') toastNetwork(saved, tRoot('common.retry'));
        else setVoucherRefusal(saved);
      }
      return null;
    }
    const data = saved.data as { id: string; expectedVersion: string };
    await attachPending(data.id);
    setEntryId(data.id);
    setState((s) => ({ ...s, id: data.id, expectedVersion: data.expectedVersion }));
    setSaved(state);
    return data.id;
  };

  const uploadFiles = async (files: File[]) => {
    setVoucherRefusal({ status: 'idle' });
    const id = await ensureSavedId();
    if (!id) return;
    for (const file of files) {
      const formData = new FormData();
      formData.append('entryId', id);
      formData.append('typeKey', voucherTypeKey);
      formData.append('documentDate', state.entryDate);
      formData.append('file', file);
      const result = await guarded(() => uploadVoucherAction(formData), tRoot('common.network'));
      if (result.status !== 'success') {
        if (result.status === 'error') {
          if (result.kind === 'network') toastNetwork(result, tRoot('common.retry'), () => void uploadFiles([file]));
          else setVoucherRefusal(result);
        }
        continue;
      }
      if (result.message) toast.warning(result.message);
      const data = result.data as { linkId: string; documentId: string; documentNumber: string };
      setVouchers((prev) => [...prev, { linkId: data.linkId, documentNumber: data.documentNumber, title: file.name, typeLabel: t('voucherType'), date: state.entryDate, viewHref: `/finance/entries/${id}/voucher/${data.documentId}`, revoked: false }]);
    }
  };

  const pickFromArchive = async (documentId: string) => {
    setVoucherRefusal({ status: 'idle' });
    const id = await ensureSavedId();
    if (!id) return;
    const result = await guarded(() => attachDocumentAction(id, documentId), tRoot('common.network'));
    if (result.status === 'error') {
      if (result.kind === 'network') toastNetwork(result, tRoot('common.retry'), () => void pickFromArchive(documentId));
      else setVoucherRefusal(result);
    } else if (result.status === 'success') router.refresh();
  };

  const purposeReason = actionState.status === 'error' ? actionState.code === 'purposeGoesNegative' || (actionState.code !== 'boardAllowanceNeedsReason' && state.reasonKind === 'purpose') : state.reasonKind === 'purpose';
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
        {/* Raster nur innerhalb der Karte (Entscheidung zum Inventar): Datum `s` und Text `l` ergeben eine Zeile. */}
        <FormGrid>
          <FormField id="entry-date" label={t('date')} size="s">
            <Input ref={dateRef} id="entry-date" type="date" value={state.entryDate} onChange={(e) => setState((s) => ({ ...s, entryDate: e.target.value }))} required />
            {/* Befund 20: warnt, sperrt aber nicht — erst Festschreiben lehnt ein Datum nach heute ab. */}
            {state.entryDate > today ? <p className="text-[12px] text-warning">{t('futureDate')}</p> : null}
          </FormField>
          <FormField id="entry-text" label={t('text')} size="l">
            <Input id="entry-text" value={state.text} onChange={(e) => setState((s) => ({ ...s, text: e.target.value }))} required />
          </FormField>
          <FormCell size="full">
            {/* Vier Vorlagen: Segmented (MUSTER § E, ab fünf wäre es Select). Gebunden an einen Umsatz bleibt nur die gewählte frei. */}
            <Segmented
              aria-label={t('template')}
              options={TEMPLATES.map((template) => ({ value: template, label: t(`templates.${template}`), disabled: bound && state.template !== template }))}
              value={state.template}
              onValueChange={(template) => setState((s) => applyTemplate(s, template))}
            />
          </FormCell>
        </FormGrid>
      </section>

      {state.template !== 'inKind' ? (
        <section data-testid="finance-account-card" className="space-y-3 rounded-md border border-line bg-surface p-4">
          <h3 className="text-[15px] font-semibold">{t('accountCard')}</h3>
          {state.moneyRows.map((row, index) => (
            <FormGrid key={row.key}>
              {row.rawTransactionId ? (
                <FormCell as="p" data-testid="bound-money-line" size="full" className="rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[13px] tabular-nums text-ink">
                  {(() => {
                    const cents = (parseAmount(row.amountText) ?? 0) * (row.direction === 'out' ? -1 : 1);
                    return row.rawBookingDate ? t('boundLine', { date: date(row.rawBookingDate), amount: formatEuro(cents) }) : t('boundLineNoDate', { amount: formatEuro(cents) });
                  })()}
                </FormCell>
              ) : null}
              <FormField id={`account-${row.key}`} label={state.template === 'transfer' ? t(row.direction === 'out' ? 'transferFrom' : 'transferTo') : t('account')}>
                <Select id={`account-${row.key}`} value={row.accountId} disabled={!!row.rawTransactionId} onChange={(e) => setState((s) => ({ ...s, moneyRows: s.moneyRows.map((r, i) => (i === index ? { ...r, accountId: e.target.value } : r)) }))} required>
                  <option value="" disabled>
                    {t('accountPlaceholder')}
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField id={`amount-${row.key}`} label={t('amount')} size="s">
                <AmountField
                  id={`amount-${row.key}`}
                  name={`amount-${row.key}`}
                  value={row.amountText}
                  onChange={(amountText) => setState((s) => ({ ...s, moneyRows: s.moneyRows.map((r, i) => (i === index ? { ...r, amountText } : r)) }))}
                  disabled={!!row.rawTransactionId}
                  required
                  balanceHint={accountsById.get(row.accountId) ? t('balanceHint', { amount: formatEuro(accountsById.get(row.accountId)!.balanceCents) }) : undefined}
                />
              </FormField>
              {/* „begleicht offene Zahlung“ bleibt unter seiner Geldzeile (Entscheidung zum Inventar). */}
              <FormCell size="full">
                <MoneySettlements
                  row={row}
                  rowIndex={index}
                  openItems={openItems}
                  fieldErrors={validation.ok ? {} : validation.fieldErrors}
                  onChange={(settlements) => setState((s) => ({ ...s, moneyRows: s.moneyRows.map((r, i) => (i === index ? { ...r, settlements } : r)) }))}
                />
              </FormCell>
            </FormGrid>
          ))}
          {remainder !== null ? <BalanceIndicator open={remainder} /> : null}
        </section>
      ) : null}

      {state.template === 'transfer' ? (
        <p className="text-[13px] text-ink-2">{t('transferHint')}</p>
      ) : (
        <section data-testid="finance-allocation-card" className="space-y-3 rounded-md border border-line bg-surface p-4">
          <h3 className="text-[15px] font-semibold">{t('allocationCard')}</h3>
          {state.splitRows.map((row, index) => {
            const withoutRow = { ...state, splitRows: state.splitRows.filter((r) => r.key !== row.key) };
            const restForRow = remainderCents(withoutRow);
            return (
              <SplitRow
                key={row.key}
                position={index + 1}
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
        <h3 className="text-[15px] font-semibold">{t('voucherCard')}</h3>
        <RefusalNotice action state={voucherRefusal} />
        <ReceiptDrop onFiles={(files) => void uploadFiles(files)} onPickFromArchive={() => setArchiveOpen(true)} />
        {archiveOpen ? (
          <FormGrid>
            <FormCell size="m">
              <DocumentPicker id="voucher-archive" name="voucherArchive" label={t('pickFromArchive')} value={null} onChange={(doc) => doc && void pickFromArchive(doc.id)} />
            </FormCell>
          </FormGrid>
        ) : null}
        {pendingVoucher ? (
          <p data-testid="pending-voucher" className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 text-[13px]">
            <span className="font-mono text-[12px]">{pendingVoucher.number}</span>
            <span className="min-w-0 flex-1 truncate">{pendingVoucher.subject}</span>
            <span className="text-[12px] text-muted-ink">{pendingVoucher.typeLabel}</span>
            <span className="font-mono text-[12px] text-muted-ink">{date(pendingVoucher.date)}</span>
            <span className="text-[12px] font-semibold text-ink-2">{t('pendingVoucher')}</span>
          </p>
        ) : null}
        <ReceiptList items={vouchers} />
      </section>

      {/* Befund AH und Q: eine Warnung mit Pflichtbegründung, kein Verbot — die Begründung geht beim nächsten Speichern mit. */}
      {(actionState.status === 'error' && REASON_CODES.has(actionState.code ?? '')) || state.reason !== undefined ? (
        <div data-testid="board-allowance-reason">
          <Notice level="warn" reason={{ name: 'reason', value: state.reason ?? '', onChange: (value) => setState((s) => ({ ...s, reason: value })), label: purposeReason ? t('purposeNegativeReason') : t('boardAllowanceReason') }}>
            {actionState.status === 'error' && REASON_CODES.has(actionState.code ?? '') ? (actionState.detail ?? actionState.message) : purposeReason ? t('purposeNegativeReasonHint') : t('boardAllowanceReasonHint')}
          </Notice>
        </div>
      ) : null}
      {actionState.status === 'error' && actionState.code && !REASON_CODES.has(actionState.code) ? (
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

      {/* Ablehnungen ohne Code (etwa fehlendes Recht) haben keinen Ausweg und stehen schlicht über der Leiste. */}
      {actionState.status === 'error' && !actionState.code ? <RefusalNotice state={actionState} /> : null}

      <FormActionBar
        mode="create"
        back={{ href: returnTo, label: t('cancel') }}
        // Verborgen gezählt: Der Kassenhinweis bleibt stehen, die Rückfrage beim Verlassen kommt nur nach einer Eingabe.
        count={countEntryChanges(saved, state)}
        countHidden
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
          if (!validation.ok) return { status: 'error', message: t('toast.fieldsInvalid'), fieldErrors: {} };
          const result = await finalizeAction(validation.input);
          await afterSuccess(result, 'entry');
          // Die Ablehnung steht im Dialog, samt Ausweg (er schließt den Dialog und führt ihn aus); dieselbe steht auch über der Leiste.
          if (result.status === 'error' && result.code && !REASON_CODES.has(result.code)) {
            return {
              ...result,
              remedies: remediesFor(result.code).map((remedy) => ({
                label: tRoot(remedy.labelKey),
                ...(remedy.kind === 'action' ? { onSelect: () => { setConfirmFinalize(false); applyRemedy(remedy.action); } } : { href: remedy.href }),
              })),
            };
          }
          return result;
        }}
      />
    </form>
  );
}
