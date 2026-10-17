import type { RelatedPartyPaymentRow } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import type { DateFormatter } from '@/lib/date-format';
import { panelHref } from '@/components/panel-nav';
import { Empty } from '@/components/empty-value';
import { RowMenu } from '@/components/row-menu';

/**
 * E21 „Zahlungen an Vorstandsmitglieder und nahestehende Personen“
 * (Designer-README 4f, Annahme 10): Rolle am Kontakt × festgeschriebene
 * Zeilen, mit „freigegeben von“ und dem Warnwort für eine Pauschale ohne
 * bestätigte Grundlage.
 */
export async function RelatedPartyTable({ rows, approverNames, fmt }: { rows: RelatedPartyPaymentRow[]; approverNames: Map<string, string>; fmt: DateFormatter }) {
  const t = await getTranslations('finance.people.related');
  const tCommon = await getTranslations('common');
  if (rows.length === 0) return <p className="text-meta text-muted-ink">{t('empty')}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <Table data-testid="related-party-table">
        <TableHeader>
          <TableRow>
            <TableHead col="meta" className="px-3">{t('columns.date')}</TableHead>
            <TableHead col="title" className="px-3">{t('columns.person')}</TableHead>
            <TableHead col="meta" className="px-3">{t('columns.role')}</TableHead>
            <TableHead col="meta" className="px-3">{t('columns.kind')}</TableHead>
            <TableHead col="status" className="px-3">{t('columns.state')}</TableHead>
            <TableHead col="amount" className="px-3 text-right">{t('columns.amount')}</TableHead>
            <TableHead className="px-3">{t('columns.approvedBy')}</TableHead>
            <TableHead col="actions" className="w-11"><span className="sr-only">{tCommon('rowActionsColumn')}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={`${row.entryId}-${row.contactId}-${i}`} data-testid="related-party-row">
              <TableCell col="meta" className="px-3 text-ink-2">{fmt.date(row.entryDate)}</TableCell>
              <TableCell col="title" className="px-3 text-ink">{row.contactName}</TableCell>
              <TableCell col="meta" className="px-3 text-ink-2" data-testid="related-party-role">{t(`roleShort.${row.role === 'board-member' ? 'boardMember' : 'relatedParty'}`)}</TableCell>
              <TableCell col="meta" className="px-3 text-ink-2" data-testid="related-party-kind">
                {/* „Art“ (Design 4f): Herkunft mit Nummer, sonst die Kategorie; der Link führt zur Buchung. */}
                <Link href={`/finance/entries/${row.entryId}`} className="underline-offset-2 hover:underline">
                  {row.originKind !== 'other' && row.originNumber ? t(`origin.${row.originKind}`, { number: row.originNumber }) : row.categoryName}
                </Link>
              </TableCell>
              {/* Die Warnung ist ein Zustand: eigene Spalte, der Weg zur Einrichtung im Zeilenmenü (Runde 3, 119). Ohne
                  Warnung in der Ansicht fällt die Spalte weg (`Table`). */}
              <TableCell col="status" className="px-3" data-testid="related-party-state">
                {row.boardAllowanceWithoutBasis ? (
                  <span data-testid="board-allowance-warning">
                    <StatusBadge tone="warning" dot>
                      {t('withoutBasis')}
                    </StatusBadge>
                  </span>
                ) : null}
              </TableCell>
              <TableCell col="amount" className="px-3 text-right tabular-nums">{formatEuro(row.amountCents)}</TableCell>
              <TableCell className="px-3 text-ink-2" data-testid="related-party-approver">
                {row.approvedByUserId ? approverNames.get(row.approvedByUserId) ?? <Empty /> : <Empty />}
              </TableCell>
              <TableCell col="actions" className="w-11">
                <RowMenu
                  name={row.contactName}
                  items={[{ key: 'setup', label: t('toSetup'), href: panelHref('/admin/finance', 'tax'), hidden: !row.boardAllowanceWithoutBasis }]}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
