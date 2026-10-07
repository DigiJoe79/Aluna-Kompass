'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import type { ActionState } from '@/lib/actions';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { savePurposeAction, setPurposeStateAction, type PurposeInput } from './actions';
import { useSavedVersions } from '@/lib/saved-versions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

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

  // „Erfüllt“ und „aufgelöst“ stehen in den Tabellenzeilen: Die Ablehnung steht über der Tabelle. „Wieder öffnen“ hat einen Dialog mit eigener.
  const stateFb = useActionFeedback();
  const applied = (result: ActionState) => {
    if (result.status === 'success') versions.remember(result.data);
    router.refresh();
  };
  const setState = async (row: PurposeRow, how: 'fulfilled' | 'dissolved') => {
    setPending(true);
    const result = await stateFb.run(() => setPurposeStateAction(row.id, versions.latest(row).expectedVersion, how), { retry: () => void setState(row, how) });
    setPending(false);
    if (result.status === 'success') applied(result);
  };

  const stateOf = (row: PurposeRow) => (row.fulfilledAt ? 'fulfilled' : row.dissolvedAt ? 'dissolved' : 'open');

  return (
    <section className="space-y-4" data-testid="purposes-panel">
      <div className="flex items-center justify-end">
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
      <RefusalNotice action state={stateFb.state} />
      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.target')}</TableHead>
              <TableHead>{t('columns.state')}</TableHead>
              <TableHead className="text-right">{tCommon('edit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purposes.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-ink">{row.name}</TableCell>
                <TableCell className="font-mono text-ink-2">{row.targetCents !== null ? formatAmount(row.targetCents) : '—'}</TableCell>
                <TableCell>
                  <StatusBadge tone={stateOf(row) === 'open' ? 'success' : 'neutral'}>{t(`states.${stateOf(row)}`)}</StatusBadge>
                </TableCell>
                <TableCell className="text-right">
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
          onClose={() => setReopening(null)}
          onConfirm={(reason) => setPurposeStateAction(reopening.id, versions.latest(reopening).expectedVersion, 'reopen', reason)}
          onDone={(result) => {
            applied(result);
            setReopening(null);
          }}
        />
      ) : null}
    </section>
  );
}

/** F8b Annahme 7: Wiederöffnen verlangt eine Begründung — sie steht am Zweck, nie im Änderungsprotokoll. */
function ReopenDialog({ purpose, onClose, onConfirm, onDone }: { purpose: PurposeRow; onClose: () => void; onConfirm: (reason: string) => Promise<ActionState>; onDone: (result: ActionState) => void }) {
  const t = useTranslations('finance.admin.purposes');
  const tCommon = useTranslations('common');
  const [reason, setReason] = useState('');
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const confirm = async () => {
    setPending(true);
    const result = await feedback.run(() => onConfirm(reason), { retry: () => void confirm() });
    setPending(false);
    if (result.status === 'success') onDone(result);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle>{t('reopenDialog.title', { name: purpose.name })}</DialogTitle>
        <FormField id="purpose-reopen-reason" label={t('reopenDialog.reason')} required>
          <Input id="purpose-reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </FormField>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={reason.trim() === ''} saveLabel={t('actions.reopen')} onSave={() => void confirm()} state={feedback.state} />
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
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
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
    const result = await feedback.run(() => savePurposeAction(input), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved(result.data);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle>{purpose ? t('edit') : t('create')}</DialogTitle>
        <section>
          <h3 className="text-[15px] font-semibold">{t('sections.purpose')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormField id="purpose-name" label={t('columns.name')} required>
                <Input id="purpose-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </FormField>
              <FormField id="purpose-target" label={t('columns.target')} size="s">
                <Input id="purpose-target" value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder="0,00" />
              </FormField>
              <FormField id="purpose-description" label={t('description')} size="l">
                <Textarea id="purpose-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </FormField>
              <FormField id="purpose-abroad" label={t('abroad')} toggle>
                <Checkbox id="purpose-abroad" checked={abroad} onCheckedChange={(checked) => setAbroad(checked)} />
              </FormField>
            </FormGrid>
          </div>
        </section>
        <section className="border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold">{t('sections.carryForward')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormField id="purpose-carry-forward" label={t('carryForward')} size="s">
                <Input id="purpose-carry-forward" value={carryForwardText} onChange={(e) => setCarryForwardText(e.target.value)} placeholder="0,00" />
              </FormField>
              <FormField id="purpose-carry-forward-date" label={t('carryForwardDate')} size="s">
                <Input id="purpose-carry-forward-date" type="date" value={carryForwardDate} onChange={(e) => setCarryForwardDate(e.target.value)} />
              </FormField>
            </FormGrid>
          </div>
        </section>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!name} saveLabel={tCommon('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
