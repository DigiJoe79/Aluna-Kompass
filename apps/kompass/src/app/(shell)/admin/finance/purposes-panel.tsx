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
import { isNormalInList, StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAmount, formatEuro, readAmounts, type AmountError } from '@/lib/finance/amount';
import { savePurposeAction, setPurposeStateAction, type PurposeInput } from './actions';
import { useSavedVersions } from '@/lib/saved-versions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';
import { RowMenu } from '@/components/row-menu';

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
          <Link href="/finance/purposes" className="text-meta font-semibold text-ink underline underline-offset-2" data-testid="purposes-panel-overview">
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
              <TableHead col="title">{t('columns.name')}</TableHead>
              <TableHead col="amount">{t('columns.target')}</TableHead>
              <TableHead col="status">{t('columns.state')}</TableHead>
              {/* Zeilenaktionen im ⋯-Menü (Joe 11.8); der Kopf ist nur für Vorleser da (112). */}
              <TableHead col="actions" className="w-11"><span className="sr-only">{tCommon('rowActionsColumn')}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purposes.map((row) => (
              <TableRow key={row.id}>
                <TableCell col="title">
                  <RowButton aria-haspopup="dialog" onClick={() => setEditing(versions.latest(row))}>{row.name}</RowButton>
                </TableCell>
                <TableCell col="amount" className="tabular-nums text-ink-2">{row.targetCents !== null ? formatEuro(row.targetCents) : <Empty />}</TableCell>
                <TableCell col="status">
                  {isNormalInList('purposeSetup', stateOf(row)) ? null : <StatusBadge tone={statusTone('purposeSetup', stateOf(row))}>{t(`states.${stateOf(row)}`)}</StatusBadge>}
                </TableCell>
                <TableCell col="actions" className="text-right">
                  <RowMenu
                    name={row.name}
                    items={[
                      { key: 'edit', label: tCommon('edit'), onSelect: () => setEditing(versions.latest(row)) },
                      { key: 'fulfill', label: t('actions.fulfill'), hidden: stateOf(row) !== 'open', onSelect: () => void setState(row, 'fulfilled') },
                      { key: 'dissolve', label: t('actions.dissolve'), hidden: stateOf(row) !== 'open', onSelect: () => void setState(row, 'dissolved') },
                      { key: 'reopen', label: t('actions.reopen'), hidden: stateOf(row) === 'open', onSelect: () => setReopening(row) },
                    ]}
                  />
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
  // Ziel und Vortrag sind optional: leer heißt „kein Betrag“, unlesbar steht am Feld (App-B6).
  const [amountErrors, setAmountErrors] = useState<Partial<Record<'target' | 'carryForward', AmountError>>>({});
  const tAmount = useTranslations('finance.amount');
  const feedback = useActionFeedback();

  const submit = async () => {
    const amounts = readAmounts({ target: { text: targetText, required: false }, carryForward: { text: carryForwardText, required: false } });
    if (!amounts.ok) {
      setAmountErrors(amounts.errors);
      return;
    }
    setAmountErrors({});
    setPending(true);
    const input: PurposeInput = {
      id: purpose?.id,
      expectedVersion: purpose?.expectedVersion,
      name,
      description,
      targetCents: amounts.cents.target,
      abroad,
      carryForwardCents: amounts.cents.carryForward,
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
        <Section title={t('sections.purpose')}>
          <FormGrid>
            <FormField id="purpose-name" label={t('columns.name')} required>
              <Input id="purpose-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </FormField>
            <FormField id="purpose-target" label={t('columns.target')} size="s" error={amountErrors.target ? tAmount(amountErrors.target) : undefined}>
              <Input id="purpose-target" value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder="0,00" />
            </FormField>
            <FormField id="purpose-description" label={t('description')} size="l">
              <Textarea id="purpose-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
            <FormField id="purpose-abroad" label={t('abroad')} toggle>
              <Checkbox id="purpose-abroad" checked={abroad} onCheckedChange={(checked) => setAbroad(checked)} />
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('sections.carryForward')}>
          <FormGrid>
            <FormField id="purpose-carry-forward" label={t('carryForward')} size="s" error={amountErrors.carryForward ? tAmount(amountErrors.carryForward) : undefined}>
              <Input id="purpose-carry-forward" value={carryForwardText} onChange={(e) => setCarryForwardText(e.target.value)} placeholder="0,00" />
            </FormField>
            <FormField id="purpose-carry-forward-date" label={t('carryForwardDate')} size="s">
              <Input id="purpose-carry-forward-date" type="date" value={carryForwardDate} onChange={(e) => setCarryForwardDate(e.target.value)} />
            </FormField>
          </FormGrid>
        </Section>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!name} saveLabel={tCommon('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
