import type { RelatedPartyPaymentRow } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { formatDate, type DateFormatMode } from '@/lib/dates';

/**
 * E21 „Zahlungen an Vorstandsmitglieder und nahestehende Personen“
 * (Designer-README 4f, Annahme 10): Rolle am Kontakt × festgeschriebene
 * Zeilen, mit „freigegeben von“ und dem Warnwort für eine Pauschale ohne
 * bestätigte Grundlage.
 */
export async function RelatedPartyTable({ rows, approverNames, dateMode }: { rows: RelatedPartyPaymentRow[]; approverNames: Map<string, string>; dateMode: DateFormatMode }) {
  const t = await getTranslations('finance.people.related');
  if (rows.length === 0) return <p className="text-[13px] text-muted-ink">{t('empty')}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <Table data-testid="related-party-table">
        <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
          <TableRow className="h-9">
            <TableHead className="px-3">{t('columns.date')}</TableHead>
            <TableHead className="px-3">{t('columns.person')}</TableHead>
            <TableHead className="px-3">{t('columns.role')}</TableHead>
            <TableHead className="px-3">{t('columns.kind')}</TableHead>
            <TableHead className="px-3 text-right">{t('columns.amount')}</TableHead>
            <TableHead className="px-3">{t('columns.approvedBy')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={`${row.entryId}-${row.contactId}-${i}`} className="border-b border-line-2" data-testid="related-party-row">
              <TableCell className="px-3 text-ink-2">{formatDate(row.entryDate, dateMode)}</TableCell>
              <TableCell className="px-3 text-ink">{row.contactName}</TableCell>
              <TableCell className="px-3 text-ink-2" data-testid="related-party-role">{t(`roleShort.${row.role === 'board-member' ? 'boardMember' : 'relatedParty'}`)}</TableCell>
              <TableCell className="px-3 text-ink-2" data-testid="related-party-kind">
                {/* „Art“ (Design 4f): Herkunft mit Nummer, sonst die Kategorie; der Link führt zur Buchung. */}
                <Link href={`/finance/entries/${row.entryId}`} className="underline-offset-2 hover:underline">
                  {row.originKind !== 'other' && row.originNumber ? t(`origin.${row.originKind}`, { number: row.originNumber }) : row.categoryName}
                </Link>
                {row.boardAllowanceWithoutBasis ? (
                  <span className="ml-2 inline-flex flex-wrap items-center gap-1.5" data-testid="board-allowance-warning">
                    <StatusBadge tone="warning" dot>
                      {t('withoutBasis')}
                    </StatusBadge>
                    <Link href="/admin/finance?panel=tax" className="text-[12px] font-semibold underline underline-offset-2">
                      {t('toSetup')}
                    </Link>
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="px-3 text-right font-mono tabular-nums">{formatEuro(row.amountCents)}</TableCell>
              <TableCell className="px-3 text-ink-2" data-testid="related-party-approver">
                {row.approvedByUserId ? approverNames.get(row.approvedByUserId) ?? '—' : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
