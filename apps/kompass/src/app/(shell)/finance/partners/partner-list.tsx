'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
        <p className="rounded-md border border-dashed border-line-strong bg-surface p-4 text-[14px] text-muted-ink" data-testid="partners-empty">{t('emptyText')}</p>
      ) : (
        <Table data-testid="partner-rows">
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.partner')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('columns.usualBasis')}</TableHead>
              <TableHead className="text-right">{t('columns.openProofs')}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">{t('columns.lastPaid')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners.map((p) => (
              <TableRow key={p.id} data-testid={`partner-row-${p.id}`}>
                <TableCell className="whitespace-normal">
                  <RowLink href={`/finance/partners/${p.id}`} className="text-ink">
                    {p.contactName}
                  </RowLink>
                  {!p.isActive ? (
                    <span className="ml-2 align-middle">
                      <StatusBadge tone="neutral">{t('inactive')}</StatusBadge>
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-normal text-ink-2">{tStatus(p.status)}</TableCell>
                <TableCell className="hidden text-ink-2 sm:table-cell">{p.usualBasis ? tBasis(p.usualBasis) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.openProofCount}
                  {p.overdueProofCount > 0 ? <span className="text-warning"> · {t('overdue', { count: p.overdueProofCount })}</span> : null}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{p.lastPaidOn ? fmt.date(p.lastPaidOn) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
