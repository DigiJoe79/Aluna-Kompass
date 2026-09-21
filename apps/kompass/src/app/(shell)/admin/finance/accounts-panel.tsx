'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { checkIban, type IbanCheckResult } from '@/lib/finance/iban-check';
import { saveAccountAction, setAccountActiveAction, type AccountInput } from './actions';

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

  const openFor = (row: AccountRow | null) => setEditing(row ?? 'new');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[18px] text-ink">{t('title')}</h2>
        <Button size="sm" onClick={() => openFor(null)}>
          {t('create')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('dialog.name')}</TableHead>
              <TableHead className="px-4">{t('dialog.kind')}</TableHead>
              <TableHead className="px-4">{t('dialog.iban')}</TableHead>
              <TableHead className="px-4">{t('active')}</TableHead>
              <TableHead className="px-4 text-right">{tCommon('edit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((row) => (
              <TableRow key={row.id} className="h-12 border-b border-line-2" data-testid={`account-row-${row.name}`}>
                <TableCell className="px-4 font-medium text-ink">
                  {row.name} {row.isMain ? <StatusBadge tone="brand">{t('dialog.isMain')}</StatusBadge> : null}
                </TableCell>
                <TableCell className="px-4 text-ink-2">{t(`kind.${row.kind}`)}</TableCell>
                <TableCell className="px-4 font-mono text-[13px] text-muted-ink">{row.iban ?? '—'}</TableCell>
                <TableCell className="px-4">
                  <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? t('active') : t('inactiveState')}</StatusBadge>
                </TableCell>
                <TableCell className="px-4 text-right">
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
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function AccountDialog({ account, canPickDocument, onClose, onSaved }: { account: AccountRow | null; canPickDocument: boolean; onClose: () => void; onSaved: () => void }) {
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
  const [error, setError] = useState<string | null>(null);

  const ibanCheck = checkIban(iban);
  const ibanIssue = kind === 'bank' && ibanCheck.state !== 'empty' && ibanCheck.state !== 'valid' ? ibanCheck.state : null;
  const openingCents = openingText.trim() === '' ? null : parseAmount(openingText);
  const openingMismatch = (openingCents !== null && !openingDate) || (openingDate !== '' && openingCents === null);

  const submit = async () => {
    setPending(true);
    setError(null);
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
    const result = await saveAccountAction(input);
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

  const deactivate = async () => {
    if (!account) return;
    setPending(true);
    const result = await setAccountActiveAction(account.id, false, account.expectedVersion);
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
      <DialogContent className="bg-surface shadow-md sm:max-w-[480px]">
        <DialogTitle className="font-heading text-[19px]">{account ? t('edit') : t('create')}</DialogTitle>
        <div className="space-y-3.5">
          {error ? <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{error}</div> : null}
          <div className="space-y-1.5">
            <Label htmlFor="account-name" required>{t('dialog.name')}</Label>
            <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-kind">{t('dialog.kind')}</Label>
            <Select id="account-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="bank">{t('kind.bank')}</option>
              <option value="cash">{t('kind.cash')}</option>
              <option value="paymentService">{t('kind.paymentService')}</option>
            </Select>
          </div>
          {kind === 'bank' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="account-iban">{t('dialog.iban')}</Label>
                <Input id="account-iban" value={iban} onChange={(e) => setIban(e.target.value)} aria-invalid={ibanIssue !== null} />
                {ibanCheck.state === 'valid' ? <p className="text-[12px] text-success">{t('dialog.ibanState.valid')}</p> : null}
                {ibanIssue ? (
                  <p role="alert" className="text-[12px] text-error">
                    {t(`dialog.ibanState.${ibanIssue}`)}
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="account-bic">{t('dialog.bic')}</Label>
                  <Input id="account-bic" value={bic} onChange={(e) => setBic(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="account-bank-name">{t('dialog.bankName')}</Label>
                  <Input id="account-bank-name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="account-main" checked={isMain} onChange={(e) => setIsMain(e.target.checked)} className="size-4 rounded border-line" />
                <Label htmlFor="account-main" className="cursor-pointer text-[13px]">
                  {t('dialog.isMain')}
                </Label>
              </div>
              {isMain ? <p className="text-[12px] text-muted-ink">{t('dialog.isMainHint')}</p> : null}
            </>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="account-opening">{t('dialog.openingBalance')}</Label>
              <Input id="account-opening" value={openingText} onChange={(e) => setOpeningText(e.target.value)} placeholder="0,00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-opening-date">{t('dialog.openingDate')}</Label>
              <Input id="account-opening-date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
            </div>
          </div>
          {openingMismatch ? <p role="alert" className="text-[12px] text-error">{t('dialog.openingBoth')}</p> : null}
          {canPickDocument ? (
            <DocumentPicker id="account-document" name="document" label={t('dialog.document')} value={document} onChange={setDocument} />
          ) : (
            <p className="text-[12px] text-muted-ink">{t('dialog.documentNoAccess')}</p>
          )}
        </div>
        <DialogFooter className="justify-between">
          {account && !account.isMain ? (
            <button type="button" className="text-[13px] font-semibold text-brand underline" onClick={() => void deactivate()} disabled={pending}>
              {t('deactivate')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" disabled={pending || !name || openingMismatch} onClick={() => void submit()}>
              {t('dialog.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
