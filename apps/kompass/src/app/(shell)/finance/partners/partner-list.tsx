'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty } from '@/components/empty-value';
import { EmptyState } from '@/components/empty-state';

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
        // 09 B28: Leer über `EmptyState`, nicht von Hand gebaut.
        <div data-testid="partners-empty">
          <EmptyState title={t('emptyTitle')} text={t('emptyText')} />
        </div>
      ) : (
        <Table data-testid="partner-rows">
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('columns.partner')}</TableHead>
              <TableHead col="status">{t('columns.status')}</TableHead>
              {/* Ohne Rolle: Die übliche Art ist fast überall „Förderung“ und weicht unter `lg` und am Telefon (Runde 3, 115). */}
              <TableHead>{t('columns.usualBasis')}</TableHead>
              <TableHead col="meta" className="text-right">{t('columns.openProofs')}</TableHead>
              <TableHead col="meta" className="text-right">{t('columns.lastPaid')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners.map((p) => (
              // Deaktiviert ist die gedämpfte Zeile mit Marke hinter dem Namen (Joe 11.8).
              <TableRow key={p.id} data-testid={`partner-row-${p.id}`} muted={p.isActive ? undefined : t('inactive')}>
                <TableCell col="title" className="whitespace-normal">
                  {/* 09 B28: Der Name in Linkfarbe — `text-ink` überschrieb den `RowLink`. */}
                  <RowLink href={`/finance/partners/${p.id}`}>
                    {p.contactName}
                  </RowLink>
                </TableCell>
                <TableCell col="status" className="whitespace-normal text-ink-2">{tStatus(p.status)}</TableCell>
                <TableCell className="text-ink-2">{p.usualBasis ? tBasis(p.usualBasis) : <Empty />}</TableCell>
                <TableCell col="meta" className="text-right tabular-nums">
                  {/* Nullen fallen weg (09: 115). */}
                  {/* Ein offener Nachweis ist Arbeit: ocker (Runde 3, 115). */}
                  {p.openProofCount > 0 ? <span className="text-warning">{p.openProofCount}</span> : <Empty />}
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
