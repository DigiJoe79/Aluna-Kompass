'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createFirstFiscalYearAction, updateFiscalYearAction } from './actions';

export interface FiscalYearRow {
  id: string;
  expectedVersion: string;
  designation: string;
  startsOn: string;
  endsOn: string;
  status: 'open' | 'closed';
  taxReturnFiledOn: string | null;
  /** Befund 15 (Weg 2): Kennzeichen statt Zusatz in der Bezeichnung. */
  isShortYear: boolean;
}

/** H5 — Tabelle + „Erstes Geschäftsjahr anlegen“; die Bezeichnung ist nach der ersten Buchungsnummer gesperrt, der Grund steht am Feld. */
export function FiscalYearsPanel({ years }: { years: FiscalYearRow[] }) {
  const t = useTranslations('finance.admin.fiscalYears');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { date } = useDateFormat();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<FiscalYearRow | null>(null);

  return (
    <section className="space-y-4" data-testid="fiscal-years-panel">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[18px] text-ink">{t('title')}</h2>
        {years.length === 0 ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            {t('createFirst')}
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('designation')}</TableHead>
              <TableHead className="px-4">{t('range')}</TableHead>
              <TableHead className="px-4">{t('status')}</TableHead>
              <TableHead className="px-4">{t('taxReturnFiledOn')}</TableHead>
              <TableHead className="px-4 text-right">{tCommon('edit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((year) => (
              <TableRow key={year.id} className="h-12 border-b border-line-2">
                <TableCell className="px-4">
                  <span className="font-mono font-semibold text-ink">{year.designation}</span>
                  {year.isShortYear ? (
                    <StatusBadge tone="neutral" className="ml-2">
                      {t('shortYear', { from: date(year.startsOn), to: date(year.endsOn) })}
                    </StatusBadge>
                  ) : null}
                </TableCell>
                <TableCell className="px-4 text-ink-2">
                  {year.startsOn} – {year.endsOn}
                </TableCell>
                <TableCell className="px-4">
                  <StatusBadge tone={year.status === 'open' ? 'success' : 'neutral'}>{t(`statusValues.${year.status}`)}</StatusBadge>
                </TableCell>
                <TableCell className="px-4 text-ink-2">{year.taxReturnFiledOn ?? '—'}</TableCell>
                <TableCell className="px-4 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(year)}>
                    {tCommon('edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {createOpen ? (
        <CreateFirstYearDialog
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      ) : null}
      {editing ? (
        <EditYearDialog
          year={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function CreateFirstYearDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('finance.admin.fiscalYears');
  const tCommon = useTranslations('common');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await createFirstFiscalYearAction({ startsOn, endsOn });
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onSaved();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[420px]">
        <DialogTitle className="font-heading text-[19px]">{t('createFirst')}</DialogTitle>
        <p className="text-[13px] text-muted-ink">{t('createFirstHint')}</p>
        <div className="space-y-3.5">
          {error ? <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{error}</div> : null}
          <div className="space-y-1.5">
            <Label htmlFor="fy-starts" required>{t('startsOn')}</Label>
            <Input id="fy-starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fy-ends" required>{t('endsOn')}</Label>
            <Input id="fy-ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={pending || !startsOn || !endsOn} onClick={() => void submit()}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditYearDialog({ year, onClose, onSaved }: { year: FiscalYearRow; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('finance.admin.fiscalYears');
  const tCommon = useTranslations('common');
  const [designation, setDesignation] = useState(year.designation);
  const [taxReturnFiledOn, setTaxReturnFiledOn] = useState(year.taxReturnFiledOn ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await updateFiscalYearAction({ id: year.id, expectedVersion: year.expectedVersion, designation, taxReturnFiledOn: taxReturnFiledOn || null });
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      toast.error(result.message);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[420px]">
        <DialogTitle className="font-heading text-[19px]">{t('edit')}</DialogTitle>
        <div className="space-y-3.5">
          {error ? (
            <div role="alert" className="rounded-md bg-error-bg p-2.5 text-[13px] text-error" data-testid="fiscal-year-designation-error">
              {error}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="fy-designation">{t('designation')}</Label>
            <Input id="fy-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fy-tax-return">{t('taxReturnFiledOn')}</Label>
            <Input id="fy-tax-return" type="date" value={taxReturnFiledOn} onChange={(e) => setTaxReturnFiledOn(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={pending} onClick={() => void submit()}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
