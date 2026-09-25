'use client';

import { PenLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { recordDispatchAction } from './actions';
import { VoidDialog } from './void-dialog';

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
export function ConfirmationsTable({ rows, canIssue, initialOpenId, today }: { rows: ConfirmationRow[]; canIssue: boolean; initialOpenId: string | null; today: string }) {
  const t = useTranslations('finance.donations');
  const { date } = useDateFormat();
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [voiding, setVoiding] = useState<ConfirmationRow | null>(null);
  const [dispatching, setDispatching] = useState<ConfirmationRow | null>(null);

  const stateOf = (row: ConfirmationRow) => {
    if (row.state === 'voided') return <StatusBadge tone="neutral">{t('state.voided')}</StatusBadge>;
    if (row.toCorrect.length > 0) {
      return (
        <span className="space-x-1.5">
          <StatusBadge tone="warning">{t('state.toCorrect')}</StatusBadge>
          <span className="text-[12px] text-ink-2">{row.toCorrect.map((reason) => t(`toCorrectReason.${reason}`)).join(', ')}</span>
        </span>
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
          <TableRow className="h-9">
            <TableHead className="px-4">{t('columns.number')}</TableHead>
            <TableHead className="px-4">{t('columns.issuedOn')}</TableHead>
            <TableHead className="px-4">{t('columns.contact')}</TableHead>
            <TableHead className="px-4">{t('columns.kind')}</TableHead>
            <TableHead className="px-4 text-right">{t('columns.amount')}</TableHead>
            <TableHead className="px-4">{t('columns.period')}</TableHead>
            <TableHead className="px-4">{t('columns.sent')}</TableHead>
            <TableHead className="px-4">{t('columns.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <TableRow
                data-testid="confirmation-row"
                tabIndex={0}
                aria-expanded={openId === row.id}
                onClick={() => toggle(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') toggle(row.id);
                }}
                className="h-row cursor-pointer border-b border-line-2 hover:bg-row-hover"
              >
                <TableCell data-testid="confirmation-number" className="px-4 font-mono">{row.number}</TableCell>
                <TableCell className="px-4">{date(row.issuedOn)}</TableCell>
                <TableCell className="px-4">{row.contactName}</TableCell>
                <TableCell className="px-4">{t(`kind.${row.kind}`)}</TableCell>
                <TableCell className="px-4 text-right font-mono tabular-nums">{formatEuro(row.totalCents)}</TableCell>
                <TableCell className="px-4">{row.periodFrom && row.periodTo ? `${date(row.periodFrom)} – ${date(row.periodTo)}` : '—'}</TableCell>
                <TableCell className="px-4">{row.sentAt && row.sentVia ? t('sentValue', { date: date(row.sentAt), via: t(`sentVia.${row.sentVia}`) }) : '—'}</TableCell>
                <TableCell data-testid="confirmation-state" className="px-4">{stateOf(row)}</TableCell>
              </TableRow>
              {openId === row.id ? (
                <TableRow className="border-b border-line-2 bg-surface-2">
                  <TableCell colSpan={8} className="px-4 py-3">
                    <Detail row={row} canIssue={canIssue} onVoid={() => setVoiding(row)} onDispatch={() => setDispatching(row)} />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))}
        </TableBody>
      </Table>
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
    </div>
  );
}

function Detail({ row, canIssue, onVoid, onDispatch }: { row: ConfirmationRow; canIssue: boolean; onVoid: () => void; onDispatch: () => void }) {
  const t = useTranslations('finance.donations');
  const { date } = useDateFormat();
  return (
    <div data-testid="confirmation-detail" className="grid grid-cols-1 gap-4 text-[13px] md:grid-cols-[2fr_1fr]">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('detail.lines')}</p>
        <ul className="space-y-1">
          {row.lines.map((line) => (
            <li key={line.lineId} className="flex items-center justify-between gap-3">
              <Link href={`/finance/entries/${line.entryId}`} className="font-mono text-link underline" onClick={(e) => e.stopPropagation()}>
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
        {row.voidedAt ? <p className="text-ink-2">{t('detail.voidedOn', { date: date(row.voidedAt.slice(0, 10)) })}</p> : null}
      </div>
      <div className="flex flex-col items-start gap-2">
        <a href={`/finance/donations/${row.id}/copy`} target="_blank" rel="noreferrer" className="text-link underline">
          {t('detail.copy')}
        </a>
        {canIssue && row.state === 'valid' && !row.sentAt ? (
          <Button type="button" variant="outline" size="sm" onClick={onDispatch}>{t('detail.dispatch')}</Button>
        ) : null}
        {canIssue && row.state === 'valid' ? (
          <Button type="button" variant="destructive" size="sm" onClick={onVoid}>{t('detail.void')}</Button>
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

  const submit = async () => {
    setPending(true);
    const result = await recordDispatchAction({ id: row.id, sentAt, sentVia });
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{td('title', { number: row.number })}</DialogTitle>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dispatch-date" required>{td('sentAt')}</Label>
            <Input id="dispatch-date" type="date" value={sentAt} max={today} onChange={(e) => setSentAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dispatch-via" required>{td('sentVia')}</Label>
            <Select id="dispatch-via" value={sentVia} onChange={(e) => setSentVia(e.target.value as 'post' | 'email' | 'handed')}>
              {(['post', 'email', 'handed'] as const).map((via) => (
                <option key={via} value={via}>{tv(via)}</option>
              ))}
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{td('cancel')}</Button>
          <Button type="button" disabled={!sentAt || pending} onClick={() => void submit()}>{td('submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
