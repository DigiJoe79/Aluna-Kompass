'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createFirstFiscalYearAction, updateFiscalYearAction } from './actions';
import { useSavedVersions } from '@/lib/saved-versions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

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
  const versions = useSavedVersions();

  return (
    <section className="space-y-4" data-testid="fiscal-years-panel">
      <div className="flex items-center justify-end">
        {years.length === 0 ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            {t('createFirst')}
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('designation')}</TableHead>
              <TableHead>{t('range')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead>{t('taxReturnFiledOn')}</TableHead>
              <TableHead className="text-right">{tCommon('edit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((year) => (
              <TableRow key={year.id}>
                <TableCell>
                  <span className="font-mono font-semibold text-ink">{year.designation}</span>
                  {year.isShortYear ? (
                    <StatusBadge tone="neutral" className="ml-2">
                      {t('shortYear', { from: date(year.startsOn), to: date(year.endsOn) })}
                    </StatusBadge>
                  ) : null}
                </TableCell>
                <TableCell className="text-ink-2">
                  {year.startsOn} – {year.endsOn}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={year.status === 'open' ? 'success' : 'neutral'}>{t(`statusValues.${year.status}`)}</StatusBadge>
                </TableCell>
                <TableCell className="text-ink-2">{year.taxReturnFiledOn ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(versions.latest(year))}>
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
          onSaved={(data) => {
            versions.remember(data);
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
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => createFirstFiscalYearAction({ startsOn, endsOn }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('createFirst')}</DialogTitle>
        <p className="text-[13px] text-muted-ink">{t('createFirstHint')}</p>
        <FormGrid>
          <FormField id="fy-starts" label={t('startsOn')} required size="s">
            <Input id="fy-starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
          </FormField>
          <FormField id="fy-ends" label={t('endsOn')} required size="s">
            <Input id="fy-ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required />
          </FormField>
        </FormGrid>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!startsOn || !endsOn} saveLabel={tCommon('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}

function EditYearDialog({ year, onClose, onSaved }: { year: FiscalYearRow; onClose: () => void; onSaved: (data?: unknown) => void }) {
  const t = useTranslations('finance.admin.fiscalYears');
  const tCommon = useTranslations('common');
  const [designation, setDesignation] = useState(year.designation);
  const [taxReturnFiledOn, setTaxReturnFiledOn] = useState(year.taxReturnFiledOn ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => updateFiscalYearAction({ id: year.id, expectedVersion: year.expectedVersion, designation, taxReturnFiledOn: taxReturnFiledOn || null }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved(result.data);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('edit')}</DialogTitle>
        <FormGrid>
          <FormField id="fy-designation" label={t('designation')} size="s">
            <Input id="fy-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </FormField>
          <FormField id="fy-tax-return" label={t('taxReturnFiledOn')} size="s">
            <Input id="fy-tax-return" type="date" value={taxReturnFiledOn} onChange={(e) => setTaxReturnFiledOn(e.target.value)} />
          </FormField>
        </FormGrid>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveLabel={tCommon('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
