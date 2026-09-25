'use client';

import type { InvoiceProposal, InvoiceView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { createOpenItemFromInvoiceAction } from '@/app/(shell)/finance/work/actions';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { Button, buttonVariants } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { formatEuro } from '@/lib/finance/amount';

const rateText = (rate: number): string => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(rate);
const bookHref = (rawTransactionId: string, documentId: string): string => `/finance/work?raw=${rawTransactionId}&voucher=${documentId}`;

/**
 * Die Karte „Aus der Rechnung“ (F5b, Spec 6.6): was die eingebettete
 * ZUGFeRD-/Factur-X-Rechnung eines Finanzbelegs sagt — Lieferant, Nummer,
 * Datum, Betrag, Steuer, Fälligkeit, IBAN — und was damit zu tun ist:
 * bezahlt → zum Kontoumsatz buchen, möglicherweise bezahlt → den Umsatz
 * wählen, unbezahlt → offene Zahlung anlegen, schon gebucht → nur der Link.
 * Den Vorschlag bildet der Dienst (`invoiceProposal`); die Karte zeigt ihn
 * und speichert nichts von der Rechnung (Prinzip 5). Ohne Rechnung im PDF
 * gibt es keine Karte.
 */
export function InvoiceCard({ documentId, proposal, canWrite, canCreateContact }: { documentId: string; proposal: InvoiceProposal; canWrite: boolean; canCreateContact: boolean }) {
  const t = useTranslations('finance.work.invoice');
  const { date } = useDateFormat();
  if (proposal.kind === 'noInvoice') return null;

  return (
    <section aria-label={t('title')} className="space-y-3 rounded-md border border-line bg-surface p-4 text-[13px]">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('title')}</h3>
      {proposal.kind === 'unsupported' ? (
        <UnsupportedNotice code={proposal.code} />
      ) : proposal.kind === 'alreadyVoucher' ? (
        <p className="flex flex-wrap items-center gap-3 text-ink">
          {proposal.entryNumber ? t('bookedAs', { number: proposal.entryNumber }) : t('draftVoucher')}
          <Link href={`/finance/entries/${proposal.entryId}`} className="font-semibold underline underline-offset-2">
            {t('openEntry')}
          </Link>
        </p>
      ) : (
        <>
          <InvoiceFacts invoice={proposal.invoice} />
          {proposal.kind === 'paid' ? (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="font-semibold text-ink">{t('paid', { date: date(proposal.bookingDate) })}</p>
              {canWrite ? (
                <Link href={bookHref(proposal.rawTransactionId, documentId)} className={buttonVariants({ size: 'sm' })}>
                  {t('bookToTransaction')}
                </Link>
              ) : null}
            </div>
          ) : proposal.kind === 'possiblyPaid' ? (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-ink">{t('possiblyPaid')}</p>
              <ul aria-label={t('candidatesLabel')} className="space-y-1">
                {proposal.candidates.map((c) => (
                  <li key={c.rawTransactionId}>
                    {canWrite ? (
                      <Link href={bookHref(c.rawTransactionId, documentId)} className="font-semibold underline underline-offset-2">
                        {t('candidate', { date: date(c.bookingDate), account: c.accountName })}
                      </Link>
                    ) : (
                      t('candidate', { date: date(c.bookingDate), account: c.accountName })
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <UnpaidPart documentId={documentId} invoice={proposal.invoice} existingOpenItemId={proposal.existingOpenItemId} canWrite={canWrite} canCreateContact={canCreateContact} />
          )}
        </>
      )}
    </section>
  );
}

function UnsupportedNotice({ code }: { code: Extract<InvoiceProposal, { kind: 'unsupported' }>['code'] }) {
  const t = useTranslations('finance.work.invoice');
  if (code === 'toolsMissing') {
    return (
      <Notice level="refuse" remedies={[{ label: t('toolsRemedy'), href: '/help/betrieb' }]}>
        {t('toolsMissing')}
      </Notice>
    );
  }
  return <Notice level="refuse">{code === 'currencyUnsupported' ? t('currencyUnsupported') : t('unreadable')}</Notice>;
}

/** Die Angaben der Rechnung — gelesen, nie gespeichert. */
function InvoiceFacts({ invoice }: { invoice: InvoiceView }) {
  const t = useTranslations('finance.work.invoice');
  const { date } = useDateFormat();
  const rows: [string, ReactNode][] = [
    [t('seller'), invoice.sellerName],
    [t('number'), <span key="number" className="font-mono">{invoice.invoiceNumber}</span>],
    [t('date'), <span key="date" className="font-mono tabular-nums">{date(invoice.issueDate)}</span>],
    [
      t('total'),
      <span key="total" className="font-mono tabular-nums">
        {formatEuro(invoice.grandTotalCents)}
        {invoice.typeCode === '381' ? ` · ${t('creditNote')}` : ''}
      </span>,
    ],
  ];
  if (invoice.taxes.length > 0) {
    rows.push([
      t('tax'),
      <span key="tax" className="space-y-0.5">
        {invoice.taxes.map((tax) => (
          <span key={`${tax.ratePercent}-${tax.categoryCode}`} className="block font-mono tabular-nums">
            {t('taxLine', { rate: rateText(tax.ratePercent), amount: formatEuro(tax.taxCents) })}
          </span>
        ))}
        {invoice.taxCentsDifference ? <span className="block text-[12px] text-muted-ink">{t('taxDifference', { cents: Math.abs(invoice.taxCentsDifference) })}</span> : null}
      </span>,
    ]);
  }
  if (invoice.dueDate) rows.push([t('due'), <span key="due" className="font-mono tabular-nums">{date(invoice.dueDate)}</span>]);
  if (invoice.payeeIban) {
    rows.push([t('iban'), <span key="iban" className="break-all font-mono">{invoice.payeeIban}</span>]);
    rows.push([t('contact'), invoice.contactName ?? <span key="contact" className="text-muted-ink">{t('noContact')}</span>]);
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-ink">{label}</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Unbezahlt: eine offene Zahlung — höchstens eine je Rechnung; danach nur der Weg zu ihr. */
function UnpaidPart({ documentId, invoice, existingOpenItemId, canWrite, canCreateContact }: { documentId: string; invoice: InvoiceView; existingOpenItemId: string | null; canWrite: boolean; canCreateContact: boolean }) {
  const t = useTranslations('finance.work.invoice');
  const [created, setCreated] = useState<{ id: string; kind: string } | null>(null);
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [refusal, setRefusal] = useState<Extract<ActionState, { status: 'error' }> | null>(null);
  const [pending, startTransition] = useTransition();

  const itemHref = created ? `/finance/open-items?tab=${created.kind}&item=${created.id}` : existingOpenItemId ? `/finance/open-items?item=${existingOpenItemId}` : null;

  const create = () =>
    startTransition(async () => {
      const result = await createOpenItemFromInvoiceAction({ documentId, ...(invoice.contactId ? {} : { contactId: contact?.id ?? null }) });
      if (result.status === 'success') {
        if (result.message) toast.success(result.message);
        setRefusal(null);
        setCreated(result.data as { id: string; kind: string });
      } else if (result.status === 'error') {
        setRefusal(result);
        toast.error(result.message);
      }
    });

  return (
    <div className="space-y-2 border-t border-line pt-3">
      {itemHref ? (
        <p className="flex flex-wrap items-center gap-3 text-ink">
          {t('openItemExists')}
          <Link href={itemHref} className="font-semibold underline underline-offset-2">
            {t('toOpenItems')}
          </Link>
        </p>
      ) : (
        <>
          <p className="font-semibold text-ink">{t('unpaid')}</p>
          {canWrite ? (
            <>
              {invoice.contactId ? null : (
                <ContactPicker id={`invoice-contact-${documentId}`} name="contactId" label={t('contactPicker')} value={contact} onChange={setContact} canCreate={canCreateContact} />
              )}
              <Button type="button" size="sm" onClick={create} disabled={pending}>
                {t('createOpenItem')}
              </Button>
            </>
          ) : null}
        </>
      )}
      {refusal ? <Notice level="refuse">{refusal.detail ?? refusal.message}</Notice> : null}
    </div>
  );
}
