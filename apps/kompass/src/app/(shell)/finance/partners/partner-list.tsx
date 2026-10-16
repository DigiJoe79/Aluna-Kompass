'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty } from '@/components/empty-value';

export interface PartnerRow {
  id: string;
  contactId: string;
  contactName: string;
  status: 'taxExemptBody' | 'foreignBody' | 'publicBody' | 'agent';
  usualBasis: 'transfer58' | 'agent57' | null;
  isActive: boolean;
  openProofCount: number;
  overdueProofCount: number;
  lastPaidOn: string | null;
}

/**
 * E1 (Design-Nachtrag Phase 4, Artboard 4a): die Liste als Tabelle — Partner ·
 * Status (neutraler Text, das Wort sagt es) · übliche Art · offene Nachweise
 * (überfällige im Warnton mit dem Wort) · zuletzt gezahlt. Anlegen steht auf
 * `/finance/partners/new`, der Knopf dazu in der Kopfleiste. Auf dem Telefon bleiben
 * Partner, Status und offene Nachweise stehen.
 */
export function PartnerList({ partners }: { partners: PartnerRow[] }) {
  const t = useTranslations('finance.partners.list');
  const tStatus = useTranslations('finance.partners.status');
  const tBasis = useTranslations('finance.partners.basisShort');
  const fmt = useDateFormat();
  return (
    <div className="space-y-4">
      {partners.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface p-4 text-body text-muted-ink" data-testid="partners-empty">{t('emptyText')}</p>
      ) : (
        <Table data-testid="partner-rows">
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('columns.partner')}</TableHead>
              <TableHead col="status">{t('columns.status')}</TableHead>
              <TableHead col="meta">{t('columns.usualBasis')}</TableHead>
              <TableHead col="meta" className="text-right">{t('columns.openProofs')}</TableHead>
              <TableHead col="meta" className="text-right">{t('columns.lastPaid')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners.map((p) => (
              <TableRow key={p.id} data-testid={`partner-row-${p.id}`}>
                <TableCell col="title" className="whitespace-normal">
                  <RowLink href={`/finance/partners/${p.id}`} className="text-ink">
                    {p.contactName}
                  </RowLink>
                  {!p.isActive ? (
                    <span className="ml-2 align-middle">
                      <StatusBadge tone="neutral">{t('inactive')}</StatusBadge>
                    </span>
                  ) : null}
                </TableCell>
                <TableCell col="status" className="whitespace-normal text-ink-2">{tStatus(p.status)}</TableCell>
                <TableCell col="meta" className="text-ink-2">{p.usualBasis ? tBasis(p.usualBasis) : <Empty />}</TableCell>
                <TableCell col="meta" className="text-right tabular-nums">
                  {p.openProofCount}
                  {p.overdueProofCount > 0 ? <span className="text-warning"> · {t('overdue', { count: p.overdueProofCount })}</span> : null}
                </TableCell>
                <TableCell col="meta" className="text-right tabular-nums">{p.lastPaidOn ? fmt.date(p.lastPaidOn) : <Empty />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
