'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { checkIban, type IbanCheckResult } from '@/lib/finance/iban-check';
import { saveAccountAction, setAccountActiveAction, type AccountInput } from './actions';
import { useSavedVersions } from '@/lib/saved-versions';
import { FieldError } from '@/components/forms/field-error';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';

export interface AccountRow {
  id: string;
  expectedVersion: string;
  name: string;
  kind: 'bank' | 'cash' | 'paymentService';
  iban: string | null;
  bic: string | null;
  bankName: string | null;
  openingBalanceCents: number | null;
  openingDate: string | null;
  isMain: boolean;
  isActive: boolean;
}

const IBAN_STATE_KEY: Record<IbanCheckResult['state'], string> = { empty: '', valid: 'valid', checksum: 'checksum', length: 'length' };

/**
 * H2 — Tabelle + Dialog: Name, Art, IBAN (Prüfung am Feld, kein Bankname aus
 * der IBAN), BIC, Bank, Anfangsbestand mit Stichtag (beides oder keines),
 * Hauptkonto mit Konflikten als Ablehnung. „Stilllegen statt löschen“ als
 * Link links unten im Dialog — kein roter Knopf.
 */
export function AccountsPanel({ accounts, canPickDocument }: { accounts: AccountRow[]; canPickDocument: boolean }) {
  const t = useTranslations('finance.admin.accounts');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<AccountRow | null | 'new'>(null);

  const versions = useSavedVersions();
  const openFor = (row: AccountRow | null) => setEditing(row ? versions.latest(row) : 'new');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => openFor(null)}>
          {t('create')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dialog.name')}</TableHead>
              <TableHead>{t('dialog.kind')}</TableHead>
              <TableHead>{t('dialog.iban')}</TableHead>
              <TableHead>{t('active')}</TableHead>
              <TableHead className="text-right">{tCommon('edit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((row) => (
              <TableRow key={row.id} data-testid={`account-row-${row.name}`}>
                <TableCell className="font-medium text-ink">
                  {row.name} {row.isMain ? <StatusBadge tone="brand">{t('dialog.isMain')}</StatusBadge> : null}
                </TableCell>
                <TableCell className="text-ink-2">{t(`kind.${row.kind}`)}</TableCell>
                <TableCell className="font-mono text-[13px] text-muted-ink">{row.iban ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? t('active') : t('inactiveState')}</StatusBadge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openFor(row)}>
                    {tCommon('edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <AccountDialog
          account={editing === 'new' ? null : editing}
          canPickDocument={canPickDocument}
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

function AccountDialog({ account, canPickDocument, onClose, onSaved }: { account: AccountRow | null; canPickDocument: boolean; onClose: () => void; onSaved: (data?: unknown) => void }) {
  const t = useTranslations('finance.admin.accounts');
  const tCommon = useTranslations('common');
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<'bank' | 'cash' | 'paymentService'>(account?.kind ?? 'bank');
  const [iban, setIban] = useState(account?.iban ?? '');
  const [bic, setBic] = useState(account?.bic ?? '');
  const [bankName, setBankName] = useState(account?.bankName ?? '');
  const [openingText, setOpeningText] = useState(account?.openingBalanceCents !== null && account?.openingBalanceCents !== undefined ? formatAmount(account.openingBalanceCents) : '');
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? '');
  const [isMain, setIsMain] = useState(account?.isMain ?? false);
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const ibanCheck = checkIban(iban);
  const ibanIssue = kind === 'bank' && ibanCheck.state !== 'empty' && ibanCheck.state !== 'valid' ? ibanCheck.state : null;
  const openingCents = openingText.trim() === '' ? null : parseAmount(openingText);
  const openingMismatch = (openingCents !== null && !openingDate) || (openingDate !== '' && openingCents === null);

  const submit = async () => {
    setPending(true);
    const input: AccountInput = {
      id: account?.id,
      expectedVersion: account?.expectedVersion,
      name,
      kind,
      iban: iban.trim() || null,
      bic: bic.trim() || null,
      bankName: bankName.trim() || null,
      openingBalanceCents: openingCents,
      openingDate: openingDate || null,
      isMain,
      documentId: document?.id ?? null,
    };
    const result = await feedback.run(() => saveAccountAction(input), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved(result.data);
  };

  const deactivate = async () => {
    if (!account) return;
    setPending(true);
    const result = await feedback.run(() => setAccountActiveAction(account.id, false, account.expectedVersion), { retry: () => void deactivate() });
    setPending(false);
    if (result.status === 'success') onSaved(result.data);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Mit Bankverbindung höher als ein Telefon- oder Laptopfenster: Kopf und Leiste fest, die Mitte scrollt. */}
      <DialogContent size="md" layout="fixed-footer" className="bg-surface shadow-md">
        <DialogHeader>
          <DialogTitle>{account ? t('edit') : t('create')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <section>
            <h3 className="text-[15px] font-semibold">{t('dialog.sections.account')}</h3>
            <div className="mt-3">
              <FormGrid>
                <FormField id="account-name" label={t('dialog.name')} required>
                  <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </FormField>
                <FormField id="account-kind" label={t('dialog.kind')} size="s">
                  <Select id="account-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                    <option value="bank">{t('kind.bank')}</option>
                    <option value="cash">{t('kind.cash')}</option>
                    <option value="paymentService">{t('kind.paymentService')}</option>
                  </Select>
                </FormField>
              </FormGrid>
            </div>
          </section>
          {kind === 'bank' ? (
            <section className="mt-5 border-t border-line pt-5">
              <h3 className="text-[15px] font-semibold">{t('dialog.sections.bank')}</h3>
              <div className="mt-3">
                <FormGrid>
                  <FormField id="account-iban" label={t('dialog.iban')} error={ibanIssue ? t(`dialog.ibanState.${ibanIssue}`) : undefined}>
                    <Input id="account-iban" value={iban} onChange={(e) => setIban(e.target.value)} aria-invalid={ibanIssue !== null} />
                    {ibanCheck.state === 'valid' ? <p className="text-[12px] text-success">{t('dialog.ibanState.valid')}</p> : null}
                  </FormField>
                  <FormField id="account-bic" label={t('dialog.bic')} size="s">
                    <Input id="account-bic" value={bic} onChange={(e) => setBic(e.target.value)} />
                  </FormField>
                  <FormField id="account-bank-name" label={t('dialog.bankName')}>
                    <Input id="account-bank-name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                  </FormField>
                  <FormField id="account-main" label={t('dialog.isMain')} hint={isMain ? t('dialog.isMainHint') : undefined} toggle>
                    <Checkbox id="account-main" checked={isMain} onCheckedChange={(checked) => setIsMain(checked)} />
                  </FormField>
                </FormGrid>
              </div>
            </section>
          ) : null}
          <section className="mt-5 border-t border-line pt-5">
            <h3 className="text-[15px] font-semibold">{t('dialog.sections.opening')}</h3>
            <div className="mt-3">
              <FormGrid>
                <FormField id="account-opening" label={t('dialog.openingBalance')} size="s">
                  <Input id="account-opening" value={openingText} onChange={(e) => setOpeningText(e.target.value)} placeholder="0,00" />
                </FormField>
                <FormField id="account-opening-date" label={t('dialog.openingDate')} size="s">
                  <Input id="account-opening-date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
                </FormField>
                {openingMismatch ? (
                  // Betrifft Betrag und Datum zusammen, deshalb über die ganze Zeile statt an einem Feld.
                  <FormCell size="full"><FieldError id="account-opening-error" message={t('dialog.openingBoth')} /></FormCell>
                ) : null}
                <FormCell size="m">
                  {canPickDocument ? (
                    <DocumentPicker id="account-document" name="document" label={t('dialog.document')} value={document} onChange={setDocument} />
                  ) : (
                    <p className="text-[12px] text-muted-ink">{t('dialog.documentNoAccess')}</p>
                  )}
                </FormCell>
              </FormGrid>
            </div>
          </section>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          cancel={onClose}
          pending={pending}
          saveDisabled={!name || openingMismatch}
          saveLabel={t('dialog.save')}
          onSave={() => void submit()}
          state={withUnplacedFieldErrors(feedback.state, [])}
          note={
            account && !account.isMain ? (
              <button type="button" className="text-[13px] font-semibold text-brand underline" onClick={() => void deactivate()} disabled={pending}>
                {t('deactivate')}
              </button>
            ) : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}
