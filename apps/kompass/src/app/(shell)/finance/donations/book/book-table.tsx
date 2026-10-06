'use client';

import type { DonationBookRow, DonationBookSums } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ActionState } from '@/lib/actions';
import { formatEuro } from '@/lib/finance/amount';
import { FormField } from '@/components/forms/form-field';

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
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });
  const tCommon = useTranslations('common');

  const download = async () => {
    setDownloading(true);
    setRefusal({ status: 'idle' });
    try {
      const response = await fetch('/finance/donations/book/simplified');
      if (!response.ok) {
        const body = response.status === 409 ? ((await response.json()) as { message?: string }) : null;
        setRefusal({ status: 'error', message: body?.message ?? t('simplified.failed'), fieldErrors: {} });
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
    } catch {
      // Der Server war nicht zu erreichen: keine Ablehnung, sondern ein Toast zum Wiederholen.
      toast.error(tCommon('network'), { duration: Infinity, closeButton: true, action: { label: tCommon('retry'), onClick: () => void download() } });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <FormField id="book-year" label={t('year')} className="w-32">
          <Select id="book-year" value={String(year)} onChange={(e) => router.push(`/finance/donations/book?year=${e.target.value}`)}>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </Select>
        </FormField>
        <div className="max-w-prose space-y-1">
          <RefusalNotice action state={refusal} />
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
              <TableRow>
                <TableHead>{t('columns.date')}</TableHead>
                <TableHead>{t('columns.contact')}</TableHead>
                <TableHead>{t('columns.kind')}</TableHead>
                <TableHead className="text-right">{t('columns.amount')}</TableHead>
                <TableHead>{t('columns.purpose')}</TableHead>
                <TableHead>{t('columns.confirmed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.lineId} data-testid="book-row">
                  <TableCell>{date(row.entryDate)}</TableCell>
                  <TableCell>{row.contactName ?? t('anonymous')}</TableCell>
                  <TableCell>{t(`sums.${row.kind}`)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatEuro(row.amountCents)}</TableCell>
                  <TableCell>{row.purposeName ?? t('noPurpose')}</TableCell>
                  <TableCell data-testid="book-confirmed">
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
