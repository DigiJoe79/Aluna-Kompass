'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { savePartnerProfileAction } from './actions';

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
 * (überfällige im Warnton mit dem Wort) · zuletzt gezahlt. Oben „Partner
 * anlegen“: ein Kontakt wählen, dann den Status. Auf dem Telefon bleiben
 * Partner, Status und offene Nachweise stehen.
 */
export function PartnerList({ partners, canWrite }: { partners: PartnerRow[]; canWrite: boolean }) {
  const t = useTranslations('finance.partners.list');
  const tStatus = useTranslations('finance.partners.status');
  const tBasis = useTranslations('finance.partners.basisShort');
  const fmt = useDateFormat();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [status, setStatus] = useState<PartnerRow['status']>('taxExemptBody');
  const [pending, setPending] = useState(false);

  const create = async () => {
    if (!contact) return;
    setPending(true);
    const result = await savePartnerProfileAction({ contactId: contact.id, status });
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      const data = result.data as { id: string } | undefined;
      setCreating(false);
      setContact(null);
      if (data?.id) router.push(`/finance/partners/${data.id}`);
      else router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      {canWrite ? (
        creating ? (
          <div className="space-y-3 rounded-md border border-line bg-surface p-4" data-testid="partner-create-form">
            <ContactPicker id="partner-new-contact" name="contactId" label={t('create.contact')} value={contact} onChange={setContact} canCreate />
            <Select id="partner-new-status" value={status} onChange={(e) => setStatus(e.target.value as PartnerRow['status'])} aria-label={t('create.status')}>
              {(['taxExemptBody', 'publicBody', 'agent', 'foreignBody'] as const).map((s) => (
                <option key={s} value={s}>{tStatus(s)}</option>
              ))}
            </Select>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>{t('create.cancel')}</Button>
              <Button type="button" disabled={!contact || pending} onClick={() => void create()}>{t('create.save')}</Button>
            </div>
          </div>
        ) : (
          <Button type="button" onClick={() => setCreating(true)} data-testid="partner-create-trigger">
            {t('new')}
          </Button>
        )
      ) : null}

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
                  <Link href={`/finance/partners/${p.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                    {p.contactName}
                  </Link>
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
