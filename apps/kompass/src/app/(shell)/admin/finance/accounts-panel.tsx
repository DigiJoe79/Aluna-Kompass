'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { toastUndo, withUnplacedFieldErrors } from '@/lib/feedback';
import { Notice } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAmount, readAmount } from '@/lib/finance/amount';
import { checkIban, type IbanCheckResult } from '@/lib/finance/iban-check';
import { saveAccountAction, setAccountActiveAction, type AccountInput } from './actions';
import { useSavedVersions } from '@/lib/saved-versions';
import { FieldError } from '@/components/forms/field-error';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';
import { formatIban } from '@kompass/module-finance/format';
import { RowMenu } from '@/components/row-menu';

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
 * Hauptkonto mit Konflikten als Ablehnung. „Stilllegen“ als Aktion am Datensatz links im Dialogfuß (`recordAction`,
 * Spec Seitenkopf § 3.3), ohne Rückfrage mit „Rückgängig“; ein stillgelegtes Konto trägt die Marke neben dem Titel
 * und „Wieder aktivieren“ sichtbar im Kopf. Das Hauptkonto hat keinen Eintrag, sondern den Grund als Hinweis im Kopf.
 */
export function AccountsPanel({ accounts, canPickDocument }: { accounts: AccountRow[]; canPickDocument: boolean }) {
  const t = useTranslations('finance.admin.accounts');
  const tMuted = useTranslations('common.muted');
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
              <TableHead col="title">{t('dialog.name')}</TableHead>
              <TableHead col="meta">{t('dialog.kind')}</TableHead>
              <TableHead col="meta">{t('dialog.iban')}</TableHead>
              {/* Zeilenaktionen im ⋯-Menü (Joe 11.8); der Kopf ist nur für Vorleser da (112). */}
              <TableHead col="actions" className="w-11"><span className="sr-only">{tCommon('rowActionsColumn')}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((row) => (
              <TableRow key={row.id} data-testid={`account-row-${row.name}`} muted={row.isActive ? undefined : tMuted('retired')}>
                <TableCell col="title">
                  <RowButton aria-haspopup="dialog" onClick={() => openFor(row)}>{row.name}</RowButton> {row.isMain ? <StatusBadge tone="brand">{t('dialog.isMain')}</StatusBadge> : null}
                </TableCell>
                <TableCell col="meta" className="text-ink-2">{t(`kind.${row.kind}`)}</TableCell>
                <TableCell col="meta" className="font-mono text-meta text-muted-ink">{row.iban ? formatIban(row.iban) : <Empty />}</TableCell>
                <TableCell col="actions" className="text-right">
                  <RowMenu name={row.name} items={[{ key: 'edit', label: tCommon('edit'), onSelect: () => openFor(row) }]} />
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
  const tErrors = useTranslations('finance.errors');
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
  const tAmount = useTranslations('finance.amount');
  const feedback = useActionFeedback();

  const ibanCheck = checkIban(iban);
  const ibanIssue = kind === 'bank' && ibanCheck.state !== 'empty' && ibanCheck.state !== 'valid' ? ibanCheck.state : null;
  // Anfangsbestand optional; ein unlesbarer zählt als eingetragen und steht sofort am Feld, statt still „kein
  // Anfangsbestand“ zu werden (App-B7f): Speichern ist ohne Tag gesperrt, erst beim Speichern käme der Satz zu spät.
  // Betrag und Tag gehören zusammen.
  const opening = readAmount(openingText, { required: false });
  const openingFilled = openingText.trim() !== '';
  const openingMismatch = (openingFilled && !openingDate) || (openingDate !== '' && !openingFilled);

  const submit = async () => {
    if (!opening.ok) return;
    setPending(true);
    const input: AccountInput = {
      id: account?.id,
      expectedVersion: account?.expectedVersion,
      name,
      kind,
      iban: iban.trim() || null,
      bic: bic.trim() || null,
      bankName: bankName.trim() || null,
      openingBalanceCents: opening.cents,
      openingDate: openingDate || null,
      isMain,
      documentId: document?.id ?? null,
    };
    const result = await feedback.run(() => saveAccountAction(input), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved(result.data);
  };

  // Umkehrbar, der Gegenweg steht danach dauerhaft im Dialog: ohne Rückfrage, „Rückgängig“ im Toast (MUSTER § C).
  const setActive = async (next: boolean) => {
    if (!account) return;
    setPending(true);
    const result = await feedback.run(() => setAccountActiveAction(account.id, next, account.expectedVersion), { retry: () => void setActive(next) });
    setPending(false);
    if (result.status !== 'success') return;
    onSaved(result.data);
    const version = (result.data as { updatedAt?: string } | undefined)?.updatedAt ?? account.expectedVersion;
    toastUndo(
      next ? t('toast.activated') : t('toast.deactivated'),
      async () => {
        const undone = await setAccountActiveAction(account.id, !next, version);
        if (undone.status === 'success') onSaved(undone.data);
        return undone;
      },
      { undo: tCommon('undo'), network: tCommon('network') },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Mit Bankverbindung höher als ein Telefon- oder Laptopfenster: Kopf und Leiste fest, die Mitte scrollt. */}
      <DialogContent size="md" layout="fixed-footer" className="bg-surface shadow-md">
        <DialogHeader>
          {/* Marke neben dem Titel wie `PageHeader status`, „Wieder aktivieren“ als nächster Schritt sichtbar daneben (Spec Seitenkopf § 3.4). */}
          <div className="flex flex-wrap items-center gap-2.5">
            <DialogTitle>{account ? t('edit') : t('create')}</DialogTitle>
            {account && !account.isActive ? <StatusBadge tone="neutral">{t('inactiveState')}</StatusBadge> : null}
            {account && !account.isActive ? (
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void setActive(true)} data-testid="account-activate">
                {t('activate')}
              </Button>
            ) : null}
          </div>
          {account?.isMain ? (
            <Notice level="hint">
              {tErrors('mainAccountMustStayActive.reason')} {tErrors('mainAccountMustStayActive.remedy')}
            </Notice>
          ) : null}
        </DialogHeader>
        <DialogBody>
          <Section title={t('dialog.sections.account')}>
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
          </Section>
          {kind === 'bank' ? (
            <Section title={t('dialog.sections.bank')}>
              <FormGrid>
                <FormField id="account-iban" label={t('dialog.iban')} error={ibanIssue ? t(`dialog.ibanState.${ibanIssue}`) : undefined}>
                  <Input id="account-iban" value={iban} onChange={(e) => setIban(e.target.value)} aria-invalid={ibanIssue !== null} />
                  {ibanCheck.state === 'valid' ? <p className="text-hint text-success">{t('dialog.ibanState.valid')}</p> : null}
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
            </Section>
          ) : null}
          <Section title={t('dialog.sections.opening')}>
            <FormGrid>
              <FormField id="account-opening" label={t('dialog.openingBalance')} size="s" error={opening.ok ? undefined : tAmount('format')}>
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
                  <p className="text-hint text-muted-ink">{t('dialog.documentNoAccess')}</p>
                )}
              </FormCell>
            </FormGrid>
          </Section>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          cancel={onClose}
          pending={pending}
          saveDisabled={!name || openingMismatch}
          saveLabel={t('dialog.save')}
          onSave={() => void submit()}
          state={withUnplacedFieldErrors(feedback.state, [])}
          recordAction={account && account.isActive && !account.isMain ? { key: 'deactivate', label: t('deactivate'), kind: 'reversible', onSelect: () => void setActive(false), testId: 'account-deactivate' } : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
