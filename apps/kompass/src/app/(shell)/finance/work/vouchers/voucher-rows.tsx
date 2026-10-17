'use client';

import type { InvoiceProposal } from '@kompass/module-finance';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { InvoiceCard } from '@/components/finance/invoice-card';
import { Notice } from '@/components/notice';
import { buttonVariants } from '@/components/ui/button';
import { RowButton, TableCell, TableRow } from '@/components/ui/table';
import { invoiceProposalAction } from '../actions';

export interface VoucherRowData {
  id: string;
  number: string | null;
  subject: string;
  documentDate: string;
  typeLabel: string;
}

type Loaded = { state: 'loading' } | { state: 'ready'; proposal: InvoiceProposal } | { state: 'failed'; message: string };

/**
 * Die Zeilen von „Belege ohne Buchung“, je aufklappbar (Klick auf die Zeile): „Aus der Rechnung“
 * liest die Karte erst auf Abruf (Server Action), weil jedes Lesen das PDF
 * nach Anhängen durchsucht. Ohne Rechnung im PDF steht ein Satz statt einer
 * Karte.
 */
export function VoucherRows({ rows, canOpenDocument, canWrite, canCreateContact }: { rows: VoucherRowData[]; canOpenDocument: boolean; canWrite: boolean; canCreateContact: boolean }) {
  const t = useTranslations('finance.work');
  const { date } = useDateFormat();
  const [open, setOpen] = useState<Record<string, Loaded>>({});

  const toggle = (id: string) => {
    if (open[id]) {
      setOpen(({ [id]: _closed, ...rest }) => rest);
      return;
    }
    setOpen((prev) => ({ ...prev, [id]: { state: 'loading' } }));
    void invoiceProposalAction(id).then((result) =>
      setOpen((prev) => (prev[id] ? { ...prev, [id]: result.ok ? { state: 'ready', proposal: result.proposal } : { state: 'failed', message: result.message } } : prev)),
    );
  };

  return (
    <>
      {rows.map((doc) => {
        const loaded = open[doc.id];
        return (
          <Fragment key={doc.id}>
            <TableRow>
              {/* 07-1 B31: Die Nummer öffnet das Dokument — ein eigener Link über der Zeilenfläche. */}
              <TableCell col="meta" className="font-mono text-hint text-ink-2">
                {canOpenDocument ? (
                  <Link href={`/dms/${doc.id}`} className="text-link underline-offset-2 hover:underline">
                    {doc.number}
                  </Link>
                ) : (
                  doc.number
                )}
              </TableCell>
              {/* Runde 3, 071/076: Ein Klick auf die Zeile klappt sie auf (`RowButton`); „Aus der Rechnung“ und „Zu Buchung
                  machen“ stehen nur im aufgeklappten Teil, statt als Knopfpaar in jeder Zeile. */}
              <TableCell col="title" truncate title={doc.subject}>
                <RowButton aria-expanded={!!loaded} aria-controls={`invoice-${doc.id}`} onClick={() => toggle(doc.id)} className="inline-flex max-w-full items-start gap-1 align-middle md:items-center">
                  {loaded ? <ChevronDown className="mt-0.5 size-4 shrink-0 md:mt-0" aria-hidden /> : <ChevronRight className="mt-0.5 size-4 shrink-0 md:mt-0" aria-hidden />}
                  {/* Am Telefon bricht der Betreff um (Kartenzeile, Designer 005), ab `md` kürzt er. */}
                  <span className="min-w-0 md:truncate">{doc.subject}</span>
                </RowButton>
              </TableCell>
              <TableCell col="meta" className="text-hint tabular-nums text-ink-2">{date(doc.documentDate)}</TableCell>
              <TableCell col="meta" className="text-ink-2">{doc.typeLabel}</TableCell>
            </TableRow>
            {loaded ? (
              <TableRow id={`invoice-${doc.id}`} className="bg-surface-2 even:bg-surface-2 hover:bg-surface-2">
                <TableCell col="span" colSpan={4} className="space-y-3 py-3">
                  {loaded.state === 'loading' ? (
                    <p className="text-meta text-muted-ink">{t('invoice.loading')}</p>
                  ) : loaded.state === 'failed' ? (
                    <Notice level="refuse">{loaded.message}</Notice>
                  ) : loaded.proposal.kind === 'noInvoice' ? (
                    <p className="text-meta text-muted-ink">{t('invoice.noInvoice')}</p>
                  ) : (
                    <InvoiceCard documentId={doc.id} proposal={loaded.proposal} canWrite={canWrite} canCreateContact={canCreateContact} />
                  )}
                  {/* Die Arbeit der Liste (MUSTER § G, Ausnahme der ⋯-Regel): bleibt ein sichtbarer Knopf. */}
                  {canWrite ? (
                    <div>
                      <Link href={`/finance/entries/new?voucher=${doc.id}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                        {t('toEntry')}
                      </Link>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
