'use client';

import type { OrganKind, SeatRow } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { seatLabel } from '@/lib/governance/seat-label';
import { SeatDialog } from './organs/[id]/seat-dialog';

/** Eine Organkarte der Übersicht (Board 4a): je Platz eine Zeile — Amt, Inhaber, bis, Marke nur bei Anstehendem. */
export function OverviewOrganCard({ organ, manage, today, canPickContacts, canPickDocuments }: { organ: { id: string; kind: OrganKind; name: string; lead: string; seats: SeatRow[] }; manage: boolean; today: string; canPickContacts: boolean; canPickDocuments: boolean }) {
  const t = useTranslations('governance.overview');
  const { date } = useDateFormat();
  const [seating, setSeating] = useState<{ id: string; name: string } | null>(null);
  const markLabel = (mark: NonNullable<SeatRow['mark']>) => (mark.kind === 'termEnding' ? t('marks.termEnding', { date: mark.on ? date(mark.on) : '' }) : t(`marks.${mark.kind}`));
  return (
    <FormCard as="section">
      <FormCardBody>
        <Section
          title={organ.name}
          intro={organ.lead}
          actions={manage ? <Link href={`/governance/meetings/new?organ=${organ.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('createMeeting')}</Link> : undefined}
        >
          {organ.seats.length === 0 ? (
            <p className="text-meta text-muted-ink">{t('noOffices')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead col="title">{t('columns.office')}</TableHead>
                  <TableHead col="meta">{t('columns.holder')}</TableHead>
                  <TableHead col="meta">{t('columns.until')}</TableHead>
                  <TableHead col="status">{t('columns.state')}</TableHead>
                  {manage ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {organ.seats.map((s) => (
                  <TableRow key={`${s.officeId}:${s.seat}`}>
                    <TableCell col="title">
                      <RowLink href={`/governance/organs/${organ.id}`}>{s.officeName}</RowLink>
                    </TableCell>
                    <TableCell col="meta">{s.name ?? <Empty />}</TableCell>
                    <TableCell col="meta">{s.contactId === null ? <Empty /> : s.until !== null && s.until >= today ? t('until', { date: date(s.until) }) : s.untilSuccessor ? t('untilSuccessor') : s.until ? t('until', { date: date(s.until) }) : <Empty />}</TableCell>
                    <TableCell col="status">{s.mark ? <StatusBadge tone={statusTone('seat', s.mark.kind)} dot>{markLabel(s.mark)}</StatusBadge> : null}</TableCell>
                    {manage ? (
                      <TableCell col="actions">
                        {s.contactId === null ? <RowMenu name={seatLabel(s, t('vacant'))} items={[{ key: 'seat', label: t('seat'), onSelect: () => setSeating({ id: s.officeId, name: s.officeName }) }]} /> : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </FormCardBody>
      {seating ? <SeatDialog organId={organ.id} office={seating} today={today} canPickContacts={canPickContacts} canPickDocuments={canPickDocuments} onClose={() => setSeating(null)} /> : null}
    </FormCard>
  );
}
