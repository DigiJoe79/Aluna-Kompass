'use client';

import { PenLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState, type ReactNode } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { recordDispatchAction, recordRecallAction } from './actions';
import { VoidDialog } from './void-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

export interface ConfirmationRow {
  id: string;
  number: string;
  issuedOn: string;
  contactName: string;
  kind: 'money' | 'inKind' | 'collective';
  totalCents: number;
  periodFrom: string | null;
  periodTo: string | null;
  sentAt: string | null;
  sentVia: 'post' | 'email' | 'handed' | null;
  state: 'valid' | 'voided';
  toCorrect: string[];
  machine: boolean;
  expenseWaiver: boolean;
  signatureState: 'machine' | 'needsSignature' | 'signed';
  voidedAt: string | null;
  /** Befund E: nur bei einer zurückgenommenen, vorher versandten Bestätigung — die Rückholspur. */
  recall: { originalReturnedOn: string | null; taxOfficeInformedOn: string | null } | null;
  lines: { lineId: string; entryId: string; entryNumber: string | null; amountCents: number }[];
  notice: { kind: string; noticeDate: string } | null;
}

/**
 * Die Tabelle der ausgestellten Bestätigungen (C1): Nummer · Datum · Spender ·
 * Art · Betrag · Zeitraum · versandt · Zustand. Ein Klick klappt die Zeile auf
 * — Zuwendungen mit Link zur Buchung, Bescheid, unser Exemplar, unterschriebene
 * Fassung, Versand vermerken und „Bestätigung zurücknehmen“. Die beiden
 * letzten nur mit `finance.donationsIssue`.
 */
export function ConfirmationsTable({ rows, canIssue, initialOpenId, today, footer }: { rows: ConfirmationRow[]; canIssue: boolean; initialOpenId: string | null; today: string; /** Fuß der Tabellenkarte: `ListPager footer`. */ footer?: ReactNode }) {
  const t = useTranslations('finance.donations');
  const { date } = useDateFormat();
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [voiding, setVoiding] = useState<ConfirmationRow | null>(null);
  const [dispatching, setDispatching] = useState<ConfirmationRow | null>(null);
  const [recalling, setRecalling] = useState<ConfirmationRow | null>(null);

  // Der Grund steht als Unterzeile unter der Marke (wie Finanzamt und Steuernummer
  // unter dem Bescheid): Neben ihr machte er die Spalte so breit, dass die Tabelle
  // bei 1440 px seitlich überlief (release-0.2.7.md, Befund 14).
  const stateOf = (row: ConfirmationRow) => {
    if (row.state === 'voided') {
      return (
        <>
          <StatusBadge tone="neutral">{t('state.voided')}</StatusBadge>
          {row.toCorrect.length > 0 ? <span className="block text-[12px] text-ink-2">{row.toCorrect.map((reason) => t(`toCorrectReason.${reason}`)).join(', ')}</span> : null}
        </>
      );
    }
    if (row.toCorrect.length > 0) {
      return (
        <>
          <StatusBadge tone="warning">{t('state.toCorrect')}</StatusBadge>
          <span className="block text-[12px] text-ink-2">{row.toCorrect.map((reason) => t(`toCorrectReason.${reason}`)).join(', ')}</span>
        </>
      );
    }
    // C1-5: „Unterschrift fehlt“ als zweites Badge neben „gültig“ — „unterschrieben“ und „maschinell“ bleiben Tatsachen der aufgeklappten Zeile.
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <StatusBadge tone="success">{t('state.valid')}</StatusBadge>
        {row.signatureState === 'needsSignature' ? (
          <StatusBadge tone="warning">
            <PenLine className="size-3" aria-hidden />
            {t('state.needsSignature')}
          </StatusBadge>
        ) : null}
      </span>
    );
  };

  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.number')}</TableHead>
            <TableHead>{t('columns.issuedOn')}</TableHead>
            <TableHead>{t('columns.contact')}</TableHead>
            <TableHead>{t('columns.kind')}</TableHead>
            <TableHead className="text-right">{t('columns.amount')}</TableHead>
            <TableHead>{t('columns.period')}</TableHead>
            <TableHead>{t('columns.sent')}</TableHead>
            <TableHead>{t('columns.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <TableRow data-testid="confirmation-row">
                <TableCell data-testid="confirmation-number" className="font-mono">
                  <RowButton aria-expanded={openId === row.id} onClick={() => toggle(row.id)}>
                    {row.number}
                  </RowButton>
                </TableCell>
                <TableCell>{date(row.issuedOn)}</TableCell>
                <TableCell>{row.contactName}</TableCell>
                <TableCell>{t(`kind.${row.kind}`)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatEuro(row.totalCents)}</TableCell>
                <TableCell>{row.periodFrom && row.periodTo ? `${date(row.periodFrom)} – ${date(row.periodTo)}` : '—'}</TableCell>
                <TableCell>{row.sentAt && row.sentVia ? t('sentValue', { date: date(row.sentAt), via: t(`sentVia.${row.sentVia}`) }) : '—'}</TableCell>
                <TableCell data-testid="confirmation-state" className="whitespace-normal">{stateOf(row)}</TableCell>
              </TableRow>
              {openId === row.id ? (
                <TableRow className="bg-surface-2 even:bg-surface-2 hover:bg-surface-2">
                  <TableCell colSpan={8} className="py-3">
                    <Detail row={row} canIssue={canIssue} onVoid={() => setVoiding(row)} onDispatch={() => setDispatching(row)} onRecall={() => setRecalling(row)} />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))}
        </TableBody>
      </Table>
      {footer}
      {voiding ? (
        <VoidDialog
          open
          onOpenChange={(next) => {
            if (!next) setVoiding(null);
          }}
          confirmation={{ id: voiding.id, number: voiding.number, lineCount: voiding.lines.length, sent: voiding.sentAt !== null }}
        />
      ) : null}
      {dispatching ? <DispatchDialog row={dispatching} today={today} onClose={() => setDispatching(null)} /> : null}
      {recalling ? <RecallDialog row={recalling} today={today} onClose={() => setRecalling(null)} /> : null}
    </div>
  );
}

function Detail({ row, canIssue, onVoid, onDispatch, onRecall }: { row: ConfirmationRow; canIssue: boolean; onVoid: () => void; onDispatch: () => void; onRecall: () => void }) {
  const t = useTranslations('finance.donations');
  const { date } = useDateFormat();
  return (
    <div data-testid="confirmation-detail" className="grid grid-cols-1 gap-4 text-[13px] md:grid-cols-[2fr_1fr]">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('detail.lines')}</p>
        <ul className="space-y-1">
          {row.lines.map((line) => (
            <li key={line.lineId} className="flex items-center justify-between gap-3">
              <Link href={`/finance/entries/${line.entryId}`} className="font-mono text-link underline">
                {line.entryNumber ?? line.entryId}
              </Link>
              <span className="font-mono tabular-nums text-ink-2">{formatEuro(line.amountCents)}</span>
            </li>
          ))}
        </ul>
        <p className="text-ink-2">
          <span className="font-semibold text-ink">{t('detail.notice')}: </span>
          {row.notice ? t('detail.noticeValue', { kind: t(`noticeKind.${row.notice.kind}`), date: date(row.notice.noticeDate) }) : '—'}
        </p>
        <p className="text-ink-2">
          <span className="font-semibold text-ink">{t('detail.signature')}: </span>
          {row.signatureState === 'machine' ? t('detail.machine') : row.signatureState === 'signed' ? t('detail.signed') : t('detail.needsSignature')}
        </p>
        {row.voidedAt ? <p className="text-ink-2">{t('detail.voidedOn', { date: date(row.voidedAt) })}</p> : null}
        {row.recall ? (
          <div data-testid="confirmation-recall" className="space-y-0.5 text-ink-2">
            <p>
              <span className="font-semibold text-ink">{t('detail.originalReturnedOn')}: </span>
              {row.recall.originalReturnedOn ? date(row.recall.originalReturnedOn) : t('detail.missing')}
            </p>
            <p>
              <span className="font-semibold text-ink">{t('detail.taxOfficeInformedOn')}: </span>
              {row.recall.taxOfficeInformedOn ? date(row.recall.taxOfficeInformedOn) : t('detail.missing')}
            </p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-start gap-2">
        <a href={`/finance/donations/${row.id}/copy`} target="_blank" rel="noreferrer" className="text-link underline">
          {t('detail.copy')}
        </a>
        {canIssue && row.state === 'valid' && !row.sentAt ? (
          <Button type="button" variant="outline" size="sm" onClick={onDispatch}>{t('detail.dispatch')}</Button>
        ) : null}
        {canIssue && row.state === 'valid' ? (
          <Button type="button" variant="outline" size="sm" onClick={onVoid}>{t('detail.void')}</Button>
        ) : null}
        {canIssue && row.recall && (!row.recall.originalReturnedOn || !row.recall.taxOfficeInformedOn) ? (
          <Button type="button" variant="outline" size="sm" onClick={onRecall}>{t('detail.recall')}</Button>
        ) : null}
      </div>
    </div>
  );
}

/** Versand vermerken (Annahme 9): Datum und Weg — einmal; den Versand selbst macht Kompass nicht. */
function DispatchDialog({ row, today, onClose }: { row: ConfirmationRow; today: string; onClose: () => void }) {
  const td = useTranslations('finance.donations.dispatch');
  const tv = useTranslations('finance.donations.sentVia');
  const router = useRouter();
  const [sentAt, setSentAt] = useState(today);
  const [sentVia, setSentVia] = useState<'post' | 'email' | 'handed'>('post');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => recordDispatchAction({ id: row.id, sentAt, sentVia }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle>{td('title', { number: row.number })}</DialogTitle>
        <FormGrid>
          <FormField id="dispatch-date" label={td('sentAt')} required size="s">
            <Input id="dispatch-date" type="date" value={sentAt} max={today} onChange={(e) => setSentAt(e.target.value)} />
          </FormField>
          <FormField id="dispatch-via" label={td('sentVia')} required size="s">
            <Select id="dispatch-via" value={sentVia} onChange={(e) => setSentVia(e.target.value as 'post' | 'email' | 'handed')}>
              {(['post', 'email', 'handed'] as const).map((via) => (
                <option key={via} value={via}>{tv(via)}</option>
              ))}
            </Select>
          </FormField>
        </FormGrid>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!sentAt} saveLabel={td('submit')} onSave={() => void submit()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}

/** Befund E: die Rückholspur nachtragen — nur die noch fehlenden Daten, jedes einmal. */
function RecallDialog({ row, today, onClose }: { row: ConfirmationRow; today: string; onClose: () => void }) {
  const t = useTranslations('finance.donations');
  const router = useRouter();
  const [originalReturnedOn, setOriginalReturnedOn] = useState('');
  const [taxOfficeInformedOn, setTaxOfficeInformedOn] = useState('');
  const [pending, setPending] = useState(false);
  const needsOriginal = !row.recall?.originalReturnedOn;
  const needsTaxOffice = !row.recall?.taxOfficeInformedOn;
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => recordRecallAction({ id: row.id, originalReturnedOn: originalReturnedOn || undefined, taxOfficeInformedOn: taxOfficeInformedOn || undefined }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle>{t('recall.title', { number: row.number })}</DialogTitle>
        <p className="text-[13px] text-ink-2">{t('recall.hint')}</p>
        <FormGrid>
          {needsOriginal ? (
            <FormField id="recall-returned" label={t('detail.originalReturnedOn')} size="s">
              <Input id="recall-returned" type="date" value={originalReturnedOn} max={today} onChange={(e) => setOriginalReturnedOn(e.target.value)} />
            </FormField>
          ) : null}
          {needsTaxOffice ? (
            <FormField id="recall-informed" label={t('detail.taxOfficeInformedOn')} size="s">
              <Input id="recall-informed" type="date" value={taxOfficeInformedOn} max={today} onChange={(e) => setTaxOfficeInformedOn(e.target.value)} />
            </FormField>
          ) : null}
        </FormGrid>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!originalReturnedOn && !taxOfficeInformedOn} saveLabel={t('recall.submit')} onSave={() => void submit()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
