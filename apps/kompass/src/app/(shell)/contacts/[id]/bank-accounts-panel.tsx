'use client';

import { formatIban } from '@kompass/module-finance/format';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ActionState } from '@/lib/actions';
import { checkIban } from '@/lib/finance/iban-check';
import { linkContactIbanAction, unlinkContactIbanAction } from '../actions';

export interface BankAccountItem {
  id: string;
  iban: string;
  source: 'learned' | 'manual' | 'mandate' | null;
  learnedFromEntryDate: string | null;
  createdAt: string;
  /** Wer von Hand zugeordnet hat — aufgelöst auf dem Server; `null`, wenn der Nutzer nicht mehr bekannt ist. */
  createdByName: string | null;
  coHolders: { contactId: string; name: string }[];
}

/**
 * Nebenliste „Bankverbindungen“ am Kontakt (Nachtrag MCP-Test § 3, Plan U4 Task 3): sichtbar mit `finance.read`,
 * ändern mit `finance.entriesWrite` (das Recht, das Kontakte in Buchungen zuordnet). `ui/table` mit IBAN in
 * Vierergruppen, Herkunft, „Auch bei“ mit Link und Marke „Gemeinschaftskonto“, Zeilenmenü „Entfernen …“; leer der
 * `EmptyState`. Hinzufügen im Dialog `sm` mit Prüfsumme wie H2; hängt die IBAN schon an jemandem, fragt derselbe
 * Dialog nach (Gemeinschaftskonto oder umhängen). Die Regeln stehen im Dienst.
 */
export function BankAccountsPanel({ contactId, contactName, items, canEdit }: { contactId: string; contactName: string; items: BankAccountItem[]; canEdit: boolean }) {
  const t = useTranslations('finance.contactIbans');
  const fmt = useDateFormat();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BankAccountItem | null>(null);

  const origin = (item: BankAccountItem): string => {
    if (item.source === 'learned') return item.learnedFromEntryDate ? t('origin.learned', { date: fmt.date(item.learnedFromEntryDate) }) : t('origin.learnedUndated');
    if (item.source === 'manual') return item.createdByName ? t('origin.manual', { person: item.createdByName, date: fmt.date(item.createdAt) }) : t('origin.manualUndated', { date: fmt.date(item.createdAt) });
    if (item.source === 'mandate') return t('origin.mandate');
    return t('origin.unknown');
  };

  return (
    <section data-testid="contact-bank-accounts" className="rounded-md border border-line bg-surface p-5">
      <Section
        title={t('title')}
        actions={
          canEdit ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="bank-account-add">
              {t('add')}
            </Button>
          ) : undefined
        }
      >
        {items.length === 0 ? (
          <EmptyState title={t('emptyTitle')} text={t('emptyText')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.iban')}</TableHead>
                <TableHead col="meta">{t('columns.origin')}</TableHead>
                <TableHead col="meta">{t('columns.alsoAt')}</TableHead>
                {canEdit ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} data-testid="bank-account-row">
                  <TableCell col="title" selectable>
                    <span className="font-mono">{formatIban(item.iban)}</span>
                  </TableCell>
                  <TableCell col="meta" wrap className="text-ink-2">{origin(item)}</TableCell>
                  <TableCell col="meta" wrap>
                    {item.coHolders.length > 0 ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {item.coHolders.map((holder) => (
                          <Link key={holder.contactId} href={`/contacts/${holder.contactId}`} className="text-link underline-offset-2 hover:underline">{holder.name}</Link>
                        ))}
                        <StatusBadge tone="neutral">{t('shared')}</StatusBadge>
                      </span>
                    ) : null}
                  </TableCell>
                  {canEdit ? (
                    <TableCell col="actions" className="text-right">
                      <RowMenu name={formatIban(item.iban)} items={[{ key: 'remove', label: t('remove'), onSelect: () => setRemoving(item), testId: 'bank-account-remove' }]} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {adding ? <AddIbanDialog contactId={contactId} contactName={contactName} onClose={() => setAdding(false)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={t('removeTitle', { name: contactName })}
        description={t('removeText', { name: contactName })}
        confirmLabel={t('removeConfirm')}
        destructive
        action={async () => {
          const result = await unlinkContactIbanAction({ id: removing!.id, contactId });
          if (result.status === 'success') toast.success(t('removed'));
          return result;
        }}
      />
    </section>
  );
}

const IBAN_FIELD = 'bank-account-iban';

/**
 * „IBAN hinzufügen“ (Nachtrag § 3): Feld mit Prüfsumme, ohne Bankangabe. Hängt die IBAN schon an jemandem, wird das
 * Feld gesperrt und über der Leiste steht die Rückfrage — `Notice warn` mit den Inhabern, darunter die Wahl ohne
 * Vorwahl; der Knopf nennt die Wahl und bleibt gesperrt, bis gewählt ist. „Andere IBAN“ führt zurück ins Feld.
 */
function AddIbanDialog({ contactId, contactName, onClose }: { contactId: string; contactName: string; onClose: () => void }) {
  const t = useTranslations('finance.contactIbans');
  const tCheck = useTranslations('finance.admin.accounts.dialog.ibanState');
  const router = useRouter();
  const [iban, setIban] = useState('');
  const [takenBy, setTakenBy] = useState<string | null>(null);
  const [mode, setMode] = useState<'shared' | 'move' | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const check = checkIban(iban);
  const issue = check.state === 'checksum' || check.state === 'length' ? check.state : null;
  const fieldError = feedback.state.status === 'error' ? feedback.state.fieldErrors.iban : undefined;

  const submit = async () => {
    setPending(true);
    const result: ActionState = await feedback.run(() => linkContactIbanAction({ contactId, iban, ...(mode ? { mode } : {}) }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      toast.success(t('added'));
      onClose();
      router.refresh();
      return;
    }
    // Die Rückfrage statt einer Ablehnung: Die IBAN hängt schon an jemandem.
    if (result.status === 'error' && result.code === 'contactIbanTaken' && result.detail) {
      feedback.reset();
      setTakenBy(result.detail);
      setMode(null);
    }
  };

  const otherIban = () => {
    setTakenBy(null);
    setMode(null);
    setIban('');
    feedback.reset();
  };

  const saveLabel = takenBy ? (mode === 'move' ? t('dialog.moveSubmit', { name: contactName }) : t('dialog.sharedSubmit', { name: contactName })) : t('dialog.submit');

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{contactName}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormGrid>
            <FormField id={IBAN_FIELD} label={t('dialog.iban')} required size="full" error={takenBy ? undefined : issue ? tCheck(issue) : fieldError}>
              <Input
                id={IBAN_FIELD}
                className="font-mono"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={iban}
                disabled={takenBy !== null || pending}
                aria-invalid={issue !== null && !takenBy}
                onChange={(e) => setIban(e.target.value)}
              />
            </FormField>
          </FormGrid>
          {check.state === 'valid' && !takenBy ? <p className="text-hint text-success">{tCheck('valid')}</p> : null}
          {takenBy ? (
            <>
              <Notice level="warn" testId="bank-account-taken">{t.rich('dialog.takenBy', { names: takenBy, b: (chunks) => <strong>{chunks}</strong> })}</Notice>
              <RadioGroup aria-label={t('dialog.choice')} value={mode} onValueChange={(value) => setMode(value as 'shared' | 'move')} className="gap-2">
                {(['shared', 'move'] as const).map((option) => (
                  <label key={option} className="flex items-center gap-2 text-body text-ink">
                    <RadioGroupItem value={option} />
                    {t(`dialog.${option}`, { name: contactName })}
                  </label>
                ))}
              </RadioGroup>
            </>
          ) : null}
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={onClose}
          pending={pending}
          saveLabel={saveLabel}
          saveDisabled={takenBy !== null && mode === null}
          onSave={() => void submit()}
          state={feedback.state}
          testId="bank-account-footer"
          extraActions={
            takenBy ? (
              <Button type="button" variant="outline" onClick={otherIban}>
                {t('dialog.otherIban')}
              </Button>
            ) : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}
