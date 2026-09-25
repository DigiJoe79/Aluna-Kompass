'use client';

import type { InvoiceProposal } from '@kompass/module-finance';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { InvoiceCard } from '@/components/finance/invoice-card';
import { Notice } from '@/components/notice';
import { Button, buttonVariants } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
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
 * Die Zeilen von „Belege ohne Buchung“, je aufklappbar: „Aus der Rechnung“
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
            <TableRow className="h-11 border-b border-line-2">
              <TableCell className="px-4 font-mono text-[12px] text-ink-2">{doc.number}</TableCell>
              <TableCell className="px-4 font-medium text-ink">
                {canOpenDocument ? (
                  <Link href={`/dms/${doc.id}`} className="underline underline-offset-2">
                    {doc.subject}
                  </Link>
                ) : (
                  doc.subject
                )}
              </TableCell>
              <TableCell className="px-4 font-mono text-[12px] tabular-nums text-ink-2">{date(doc.documentDate)}</TableCell>
              <TableCell className="px-4 text-ink-2">{doc.typeLabel}</TableCell>
              <TableCell className="px-4 text-right">
                <span className="inline-flex items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" aria-expanded={!!loaded} aria-controls={`invoice-${doc.id}`} onClick={() => toggle(doc.id)}>
                    {loaded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                    {t('invoice.toggle')}
                  </Button>
                  {canWrite ? (
                    <Link href={`/finance/entries/new?voucher=${doc.id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                      {t('toEntry')}
                    </Link>
                  ) : null}
                </span>
              </TableCell>
            </TableRow>
            {loaded ? (
              <TableRow id={`invoice-${doc.id}`} className="border-b border-line-2 bg-surface-2">
                <TableCell colSpan={5} className="px-4 py-3">
                  {loaded.state === 'loading' ? (
                    <p className="text-[13px] text-muted-ink">{t('invoice.loading')}</p>
                  ) : loaded.state === 'failed' ? (
                    <Notice level="refuse">{loaded.message}</Notice>
                  ) : loaded.proposal.kind === 'noInvoice' ? (
                    <p className="text-[13px] text-muted-ink">{t('invoice.noInvoice')}</p>
                  ) : (
                    <InvoiceCard documentId={doc.id} proposal={loaded.proposal} canWrite={canWrite} canCreateContact={canCreateContact} />
                  )}
                </TableCell>
              </TableRow>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
