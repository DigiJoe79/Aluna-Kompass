'use client';

import type { DonationBookRow, DonationBookSums } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';

const SUM_KINDS = ['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver'] as const;

/**
 * Spendenbuch (C4, F6b Task 8, README 3j): Jahr-Auswahl, Summen je Art in
 * Mono (Mitgliedsbeiträge nur bei eingeschaltetem Schalter, mit dem Satz
 * dazu), der Knopf „Vereinfachter Nachweis (PDF)“ mit dem Satz zur Grenze,
 * und die Tabelle aller Zuwendungen des Jahres — Rückgaben stehen negativ.
 */
export function BookTable({
  years,
  year,
  rows,
  sums,
  membershipFeesCertifiable,
  filterAnonymous,
  simplifiedReceiptLimitCents,
}: {
  years: number[];
  year: number;
  rows: DonationBookRow[];
  sums: DonationBookSums;
  membershipFeesCertifiable: boolean;
  filterAnonymous: boolean;
  simplifiedReceiptLimitCents: number | null;
}) {
  const t = useTranslations('finance.donations.book');
  const { date } = useDateFormat();
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch('/finance/donations/book/simplified');
      if (!response.ok) {
        const body = response.status === 409 ? ((await response.json()) as { message?: string }) : null;
        toast.error(body?.message ?? t('simplified.failed'));
        return;
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'Vereinfachter-Zuwendungsnachweis.pdf';
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-32 space-y-1.5">
          <Label htmlFor="book-year">{t('year')}</Label>
          <Select id="book-year" value={String(year)} onChange={(e) => router.push(`/finance/donations/book?year=${e.target.value}`)}>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </Select>
        </div>
        <div className="max-w-[360px] space-y-1">
          <Button type="button" variant="outline" disabled={downloading} onClick={() => void download()}>
            {t('simplified.action')}
          </Button>
          <p className="text-[12px] text-muted-ink">
            {simplifiedReceiptLimitCents !== null ? t('simplified.hint', { limit: formatEuro(simplifiedReceiptLimitCents) }) : t('simplified.hintUnknown')}
          </p>
        </div>
      </div>

      <div data-testid="book-sums" className="flex flex-wrap gap-x-8 gap-y-2 rounded-md border border-line bg-surface p-4">
        {SUM_KINDS.filter((kind) => kind !== 'membershipFee' || membershipFeesCertifiable).map((kind) => (
          <span key={kind} className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t(`sums.${kind}`)}</span>
            <span data-testid={`book-sum-${kind}`} className="font-mono text-[15px] tabular-nums text-ink">{formatEuro(sums[kind])}</span>
          </span>
        ))}
        <span className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('sums.total')}</span>
          <span data-testid="book-sum-total" className="font-mono text-[15px] tabular-nums text-ink">{formatEuro(sums.total)}</span>
        </span>
      </div>
      {membershipFeesCertifiable ? <p className="text-[12px] text-muted-ink">{t('sums.membershipFeeHint')}</p> : null}

      {filterAnonymous ? (
        <p data-testid="book-filter-anonymous" className="text-[13px] text-ink-2">
          {t('filter.anonymous')}
          {' · '}
          <Link href={`/finance/donations/book?year=${year}`} className="text-link underline">{t('filter.clear')}</Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="h-9">
                <TableHead className="px-4">{t('columns.date')}</TableHead>
                <TableHead className="px-4">{t('columns.contact')}</TableHead>
                <TableHead className="px-4">{t('columns.kind')}</TableHead>
                <TableHead className="px-4 text-right">{t('columns.amount')}</TableHead>
                <TableHead className="px-4">{t('columns.purpose')}</TableHead>
                <TableHead className="px-4">{t('columns.confirmed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.lineId} data-testid="book-row" className="h-row border-b border-line-2">
                  <TableCell className="px-4">{date(row.entryDate)}</TableCell>
                  <TableCell className="px-4">{row.contactName ?? t('anonymous')}</TableCell>
                  <TableCell className="px-4">{t(`sums.${row.kind}`)}</TableCell>
                  <TableCell className="px-4 text-right font-mono tabular-nums">{formatEuro(row.amountCents)}</TableCell>
                  <TableCell className="px-4">{row.purposeName ?? t('noPurpose')}</TableCell>
                  <TableCell data-testid="book-confirmed" className="px-4">
                    {row.confirmation ? (
                      <span className="inline-flex items-center gap-1">
                        <Link href={`/finance/donations?confirmation=${row.confirmation.id}`} className="font-mono text-link underline">
                          {row.confirmation.number}
                        </Link>
                        {row.confirmation.kind === 'collective' ? <span className="text-ink-2">{t('collectiveSuffix')}</span> : null}
                      </span>
                    ) : (
                      t('notConfirmed')
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
