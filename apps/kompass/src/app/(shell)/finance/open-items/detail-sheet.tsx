'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/forms/form-field';
import { BlockedState } from '@/components/blocked-state';
import { useDateFormat } from '@/components/date-format-provider';
import { TransferBlock } from '@/components/finance/transfer-block';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RecordActions } from '@/components/record-actions';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { Sheet, SheetContent, SheetFooter, SheetTitle } from '@/components/ui/sheet';
import { formatEuro } from '@/lib/finance/amount';
import { formatDateOrDash } from '@/lib/finance/dates';
import { openItemState } from '@/lib/finance/open-item-state';
import { cancelOpenItemAction } from './actions';
import { ItemDialog, type OpenItemEditable } from './item-dialog';
import { Overline } from '@/components/overline';
import { Empty } from '@/components/empty-value';
import { isNormalInList } from '@/components/status-badge';
import { OpenItemStateBadges } from './list';

/** Wo ein Posten mit Herkunft geändert wird (07-2 A3): Auslage und Zahlung an einen Partner haben ihre Freigabeseite. */
function originHref(originType: string | null, originId: string | null): string | null {
  if (!originId) return null;
  if (originType === 'financeExpenseClaim') return `/finance/approvals?claim=${originId}`;
  if (originType === 'financePartnerPayment') return `/finance/approvals?payment=${originId}`;
  return null;
}

export interface OpenItemDetailData {
  id: string;
  expectedVersion: string;
  kind: 'receivable' | 'payable';
  itemDate: string;
  contactId: string | null;
  contactLabel: string | null;
  amountCents: number;
  openCents: number;
  dueOn: string | null;
  paymentReference: string | null;
  originType: string | null;
  /** Der Vorgang, zu dem der Posten gehört (07-2 A3) — nur für den Link „dort ändern“. */
  originId: string | null;
  cancelledAt: string | null;
  /** Befund 6: > 0, solange eine Zahlung dafür als Entwurf vorliegt — dann steht das statt „überfällig“. */
  draftSettlementCents: number;
}

export interface SettlementRow {
  entryId: string;
  entryNumber: string | null;
  amountCents: number;
  entryDate: string;
}

/**
 * Detail einer offenen Zahlung als `Sheet` (HANDOFF § 5.5, Task 3): Überweisungsblock,
 * „Wird beglichen durch“, „Erledigt ohne Zahlung“ (endgültig, nur mit
 * `finance.entriesFinalize`, nie bei einem Posten mit Herkunft), „Jetzt buchen“.
 */
export function DetailSheet({
  item,
  settlements,
  canWrite,
  canFinalize,
  finalizeNames,
  canCreateContact,
  today,
  iban,
  epcPayload,
}: {
  item: OpenItemDetailData;
  settlements: SettlementRow[];
  canWrite: boolean;
  canFinalize: boolean;
  finalizeNames: string[];
  canCreateContact: boolean;
  today: string;
  iban?: string | null;
  epcPayload?: string | null;
}) {
  const t = useTranslations('finance.openItems');
  const router = useRouter();
  const { date } = useDateFormat();
  const pathname = usePathname();
  const params = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const settleTrigger = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState('');

  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('item');
    router.replace(`${pathname}?${next.toString()}`);
  };

  const state = openItemState(item, today);
  const done = state.word === 'settled' || state.word === 'settledWithoutPayment';
  const editable: OpenItemEditable = {
    id: item.id, expectedVersion: item.expectedVersion, kind: item.kind, itemDate: item.itemDate,
    contactId: item.contactId, contactLabel: item.contactLabel, amountCents: item.amountCents, dueOn: item.dueOn, paymentReference: item.paymentReference,
  };
  const bookHref = `/finance/entries/new?template=${item.kind === 'payable' ? 'expense' : 'income'}&settles=${item.id}`;

  return (
    <>
      <Sheet
        open
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        <SheetContent side="right" size="md" className="gap-0 overflow-y-auto bg-surface shadow-md">
          <div className="p-5">
            {/* 07-2 C27: Der Kontakt ist der Titel, die Referenz steht darunter. */}
            <SheetTitle>{item.contactLabel ?? item.paymentReference ?? t('detail.unnamed')}</SheetTitle>
            {item.contactLabel && item.paymentReference ? <p className="mt-1 text-meta text-muted-ink">{item.paymentReference}</p> : null}
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-amount font-semibold tabular-nums text-ink">{formatEuro(item.openCents)}</p>
                {/* 07-2 A2: „von …“ nur bei einer Teilzahlung — sonst stünde derselbe Betrag zweimal da. */}
                {item.openCents !== item.amountCents ? <p className="text-hint text-muted-ink">{t('detail.ofTotal', { amount: formatEuro(item.amountCents) })}</p> : null}
              </div>
              <dl className="space-y-1.5 text-meta">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-ink">{t('columns.contact')}</dt>
                  <dd>{item.contactLabel ?? <Empty />}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-ink">{t('columns.dueOn')}</dt>
                  {/* 07-2 B9: Überfällig sagt die Marke im Zustand, das Datum ist nicht rot. */}
                  <dd>{formatDateOrDash(date, item.dueOn)}</dd>
                </div>
                {/* Runde 3, 098: „offen“ ist der Normalfall wie in der Liste — ohne Marke fällt die Zeile weg. */}
                {state.overdue || !isNormalInList('openItem', state.word) ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-ink">{t('columns.state')}</dt>
                    <dd>
                      <OpenItemStateBadges word={state.word} overdue={state.overdue} draftSettlement={item.draftSettlementCents > 0} />
                    </dd>
                  </div>
                ) : null}
              </dl>

              <TransferBlock recipient={item.contactLabel ?? t('detail.noRecipient')} amountCents={item.openCents} reference={item.paymentReference ?? ''} iban={iban} epcPayload={epcPayload} />

              <section aria-label={t('detail.settledByTitle')}>
                <Overline>{t('detail.settledByTitle')}</Overline>
                {settlements.length === 0 ? (
                  <p className="mt-1 text-meta text-muted-ink">{t('detail.settledByEmpty')}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {settlements.map((s) => (
                      <li key={s.entryId} className="flex items-center justify-between gap-2 text-meta">
                        <Link href={`/finance/entries/${s.entryId}`} className="text-link underline">
                          {s.entryNumber ?? s.entryId}
                        </Link>
                        <span className="tabular-nums text-ink-2">{formatEuro(s.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 07-2 A3: „Gehört zu KE-…, dort ändern“ mit Link auf den Vorgang. */}
              {!done && item.originType ? (
                <p className="text-meta text-ink-2">
                  {originHref(item.originType, item.originId)
                    ? t.rich('detail.origin', { reference: item.paymentReference ?? t('detail.originUnnamed'), link: (chunks) => <Link href={originHref(item.originType, item.originId)!} className="text-link underline">{chunks}</Link> })
                    : t('detail.originNoLink', { reference: item.paymentReference ?? t('detail.originUnnamed') })}
                </p>
              ) : null}
              {!done && !item.originType && !canFinalize ? (
                <BlockedState step={t('settleWithoutPayment.trigger')} title={t('settleWithoutPayment.noRight.title')}>
                  {finalizeNames.length > 0
                    ? t('settleWithoutPayment.noRight.textWithNames', { names: finalizeNames.join(', ') })
                    : t('settleWithoutPayment.noRight.text')}
                </BlockedState>
              ) : null}
            </div>
          </div>
          {!done ? (
            // Wie die `FormActionBar` im Dialog (Spec Seitenkopf § 3.3): die Aktion am Datensatz links, die Knöpfe rechts;
            // auf dem Telefon untereinander, die Aktion zuletzt.
            <SheetFooter className="flex-row flex-wrap items-center gap-3 border-t border-line max-sm:flex-col max-sm:items-stretch">
              {!item.originType && canFinalize ? (
                <div className="max-sm:order-last max-sm:mt-3">
                  <RecordActions
                    single="button"
                    triggerRef={settleTrigger}
                    actions={[{ key: 'settle', label: t('settleWithoutPayment.item'), kind: 'undoing', onSelect: () => setSettleOpen(true), testId: 'open-item-settle-trigger' }]}
                  />
                </div>
              ) : null}
              <div className="ml-auto flex items-center gap-2 max-sm:ml-0 max-sm:flex-col-reverse max-sm:[&>*]:w-full">
                {canWrite ? (
                  <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                    {t('detail.change')}
                  </Button>
                ) : null}
                <Link href={bookHref} className={buttonVariants()}>
                  {t('detail.bookNow')}
                </Link>
              </div>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>

      {editOpen ? <ItemDialog open={editOpen} onOpenChange={setEditOpen} item={editable} defaultKind={item.kind} canCreateContact={canCreateContact} today={today} /> : null}

      <ConfirmDialog
        open={settleOpen}
        finalFocus={settleTrigger}
        onOpenChange={(o) => {
          setSettleOpen(o);
          if (!o) setNote('');
        }}
        title={t('settleWithoutPayment.title')}
        description={t('settleWithoutPayment.description')}
        confirmLabel={t('settleWithoutPayment.trigger')}
        confirmDisabled={note.trim().length === 0}
        destructive
        action={async () => {
          const result = await cancelOpenItemAction(item.id, note.trim());
          if (result.status === 'success') {
            close();
            router.refresh();
          }
          return result;
        }}
      >
        <FormField id="settle-without-payment-note" label={t('settleWithoutPayment.noteLabel')}>
          <Textarea id="settle-without-payment-note" value={note} onChange={(e) => setNote(e.target.value)} required rows={3} />
        </FormField>
      </ConfirmDialog>
    </>
  );
}
