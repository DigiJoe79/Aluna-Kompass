'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { savePurposeAction, setPurposeStateAction, type PurposeInput } from './actions';
import { useSavedVersions } from '@/lib/saved-versions';

export interface PurposeRow {
  id: string;
  expectedVersion: string;
  name: string;
  description: string | null;
  targetCents: number | null;
  abroad: boolean;
  carryForwardCents: number | null;
  carryForwardDate: string | null;
  fulfilledAt: string | null;
  dissolvedAt: string | null;
  isActive: boolean;
}

/** H4 — Zwecke: Tabelle + Dialog, erfüllt/aufgelöst/wieder öffnen. */
export function PurposesPanel({ purposes }: { purposes: PurposeRow[] }) {
  const t = useTranslations('finance.admin.purposes');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<PurposeRow | null | 'new'>(null);
  const [reopening, setReopening] = useState<PurposeRow | null>(null);
  const [pending, setPending] = useState(false);
  const versions = useSavedVersions();

  const setState = async (row: PurposeRow, how: 'fulfilled' | 'dissolved' | 'reopen', reason?: string) => {
    setPending(true);
    const result = await setPurposeStateAction(row.id, versions.latest(row).expectedVersion, how, reason);
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') versions.remember(result.data);
    router.refresh();
  };

  const stateOf = (row: PurposeRow) => (row.fulfilledAt ? 'fulfilled' : row.dissolvedAt ? 'dissolved' : 'open');

  return (
    <section className="space-y-4" data-testid="purposes-panel">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[18px] text-ink">{t('title')}</h2>
        <div className="flex items-center gap-3">
          {/* F8b 6a: Bestände, Bewegungen und Umwidmung stehen auf der operativen Seite E3. */}
          <Link href="/finance/purposes" className="text-[13px] font-semibold text-ink underline underline-offset-2" data-testid="purposes-panel-overview">
            {t('toOverview')}
          </Link>
          <Button size="sm" onClick={() => setEditing('new')}>
            {t('create')}
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('columns.name')}</TableHead>
              <TableHead className="px-4">{t('columns.target')}</TableHead>
              <TableHead className="px-4">{t('columns.state')}</TableHead>
              <TableHead className="px-4 text-right">{tCommon('edit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purposes.map((row) => (
              <TableRow key={row.id} className="h-12 border-b border-line-2">
                <TableCell className="px-4 font-medium text-ink">{row.name}</TableCell>
                <TableCell className="px-4 font-mono text-ink-2">{row.targetCents !== null ? formatAmount(row.targetCents) : '—'}</TableCell>
                <TableCell className="px-4">
                  <StatusBadge tone={stateOf(row) === 'open' ? 'success' : 'neutral'}>{t(`states.${stateOf(row)}`)}</StatusBadge>
                </TableCell>
                <TableCell className="px-4 text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(versions.latest(row))}>
                      {tCommon('edit')}
                    </Button>
                    {stateOf(row) === 'open' ? (
                      <>
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => void setState(row, 'fulfilled')}>
                          {t('actions.fulfill')}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => void setState(row, 'dissolved')}>
                          {t('actions.dissolve')}
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReopening(row)}>
                        {t('actions.reopen')}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <PurposeDialog
          purpose={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(data) => {
            versions.remember(data);
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {reopening ? (
        <ReopenDialog
          purpose={reopening}
          pending={pending}
          onClose={() => setReopening(null)}
          onConfirm={async (reason) => {
            await setState(reopening, 'reopen', reason);
            setReopening(null);
          }}
        />
      ) : null}
    </section>
  );
}

/** F8b Annahme 7: Wiederöffnen verlangt eine Begründung — sie steht am Zweck, nie im Änderungsprotokoll. */
function ReopenDialog({ purpose, pending, onClose, onConfirm }: { purpose: PurposeRow; pending: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const t = useTranslations('finance.admin.purposes');
  const tCommon = useTranslations('common');
  const [reason, setReason] = useState('');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[420px]">
        <DialogTitle className="font-heading text-[19px]">{t('reopenDialog.title', { name: purpose.name })}</DialogTitle>
        <div className="space-y-1.5">
          <Label htmlFor="purpose-reopen-reason" required>{t('reopenDialog.reason')}</Label>
          <Input id="purpose-reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={pending || reason.trim() === ''} onClick={() => void onConfirm(reason)}>
            {t('actions.reopen')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurposeDialog({ purpose, onClose, onSaved }: { purpose: PurposeRow | null; onClose: () => void; onSaved: (data?: unknown) => void }) {
  const t = useTranslations('finance.admin.purposes');
  const tCommon = useTranslations('common');
  const [name, setName] = useState(purpose?.name ?? '');
  const [description, setDescription] = useState(purpose?.description ?? '');
  const [targetText, setTargetText] = useState(purpose?.targetCents !== null && purpose?.targetCents !== undefined ? formatAmount(purpose.targetCents) : '');
  const [abroad, setAbroad] = useState(purpose?.abroad ?? false);
  const [carryForwardText, setCarryForwardText] = useState(purpose?.carryForwardCents !== null && purpose?.carryForwardCents !== undefined ? formatAmount(purpose.carryForwardCents) : '');
  const [carryForwardDate, setCarryForwardDate] = useState(purpose?.carryForwardDate ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const input: PurposeInput = {
      id: purpose?.id,
      expectedVersion: purpose?.expectedVersion,
      name,
      description,
      targetCents: targetText.trim() === '' ? null : parseAmount(targetText),
      abroad,
      carryForwardCents: carryForwardText.trim() === '' ? null : parseAmount(carryForwardText),
      carryForwardDate: carryForwardDate || null,
    };
    const result = await savePurposeAction(input);
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onSaved(result.data);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[460px]">
        <DialogTitle className="font-heading text-[19px]">{purpose ? t('edit') : t('create')}</DialogTitle>
        <div className="space-y-3.5">
          {error ? <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{error}</div> : null}
          <div className="space-y-1.5">
            <Label htmlFor="purpose-name" required>{t('columns.name')}</Label>
            <Input id="purpose-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="purpose-description">{t('description')}</Label>
            <Input id="purpose-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="purpose-target">{t('columns.target')}</Label>
            <Input id="purpose-target" value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder="0,00" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="purpose-abroad" checked={abroad} onChange={(e) => setAbroad(e.target.checked)} className="size-4 rounded border-line" />
            <Label htmlFor="purpose-abroad" className="cursor-pointer text-[13px]">
              {t('abroad')}
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="purpose-carry-forward">{t('carryForward')}</Label>
              <Input id="purpose-carry-forward" value={carryForwardText} onChange={(e) => setCarryForwardText(e.target.value)} placeholder="0,00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purpose-carry-forward-date">{t('carryForwardDate')}</Label>
              <Input id="purpose-carry-forward-date" type="date" value={carryForwardDate} onChange={(e) => setCarryForwardDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={pending || !name} onClick={() => void submit()}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
