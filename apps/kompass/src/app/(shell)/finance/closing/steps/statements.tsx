'use client';

import type { AccountYearStatementRow } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RowMenu } from '@/components/row-menu';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { useRouter } from 'next/navigation';
import { AccountConfirmDialog } from '../account-confirm-dialog';
import { confirmStatementsStepAction } from '../actions';
import { JustifyDialog } from '../justify-dialog';
import type { ClosingStepBody } from '../step-body';
import { StatementDialog } from '../statement-dialog';

type Dialog = { kind: 'file' | 'justify' | 'service'; row: AccountYearStatementRow } | null;

/**
 * Schritt 1 „Auszüge und Konten“ (Board 13b): ein Satz mit der Regel über der Liste (kein `Notice`), eine Zeile je
 * Konto — Zustand als Text, nur „Auszug fehlt“ als Marke `warning`. Darunter das Kästchen „Alle Auszüge des Jahres
 * liegen in der Akte“ und „Schritt erledigen“; gesperrt nur, solange nicht angekreuzt. Offene Zeilen sperren nicht.
 */
export function StatementsStep({ step, status, canConfirm, names, canWrite }: ClosingStepBody<'statements'> & { names: Readonly<Record<string, string>>; canWrite: boolean }) {
  const t = useTranslations('finance.closing.statements');
  const c = useTranslations('finance.closing');
  const fmt = useDateFormat();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [allFiled, setAllFiled] = useState(false);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const f = step.facts;
  const year = encodeURIComponent(status.fiscalYearId);
  const nameOf = (id: string) => names[id] ?? c('system');

  const finish = async () => {
    setPending(true);
    const result = await feedback.run(() => confirmStatementsStepAction(status.fiscalYearId), { retry: () => void finish() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const stateOf = (row: AccountYearStatementRow): { text: string | null; sub: string | null; missing: boolean } => {
    const conf = row.confirmation;
    if (row.kind === 'bank') {
      if (row.statement?.covers) return { text: null, sub: t('liesUntil', { date: fmt.date(row.statement.periodTo) }), missing: false };
      if (conf?.kind === 'missingJustified') return { text: t('justified', { note: conf.note ?? '' }), sub: t('confirmedBy', { name: nameOf(conf.byUserId), date: fmt.date(conf.at) }), missing: false };
      return { text: null, sub: row.lastStatementTo ? t('lastUntil', { date: fmt.date(row.lastStatementTo) }) : t('noneYet'), missing: true };
    }
    if (conf?.kind === 'notReconcilable') return { text: t('notReconcilable'), sub: t('confirmedBy', { name: nameOf(conf.byUserId), date: fmt.date(conf.at) }), missing: false };
    if (conf?.kind === 'balanceConfirmed') return { text: t('balanceConfirmed'), sub: t('confirmedBy', { name: nameOf(conf.byUserId), date: fmt.date(conf.at) }), missing: false };
    if (row.importedBalance) return { text: t('balance', { date: fmt.date(status.endsOn), amount: formatEuro(row.importedBalance.cents) }), sub: t('fromImport'), missing: false };
    return { text: t('noBalance'), sub: null, missing: false };
  };

  const open = (kind: 'file' | 'justify' | 'service', row: AccountYearStatementRow) => setDialog({ kind, row });
  const canWriteStatement = canWrite;

  return (
    <div className="flex flex-col gap-3" data-testid="closing-body-statements">
      <p className="text-meta text-ink-2">{t('intro', { date: fmt.date(status.endsOn) })}</p>
      {f.accountsWithoutImport > 0 || f.openTransactions > 0 ? (
        <p className="text-meta text-ink-2">
          {t('openImports', {
            parts: [f.accountsWithoutImport > 0 ? t('withoutImport', { count: f.accountsWithoutImport }) : null, f.openTransactions > 0 ? t('openTransactions', { count: f.openTransactions }) : null].filter(Boolean).join(', '),
          })}{' '}
          <Link href="/finance/imports" className="text-link underline-offset-2 hover:underline">
            {c('close.itemAction')}
          </Link>
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('columns.account')}</TableHead>
            <TableHead col="status">
              <span className="sr-only">{t('columns.state')}</span>
            </TableHead>
            <TableHead col="meta" wrap>
              {t('columns.state')}
            </TableHead>
            <TableHead col="actions">
              <span className="sr-only">{t('columns.menu')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {f.accounts.map((row) => {
            const state = stateOf(row);
            const bank = row.kind === 'bank';
            const statementLink = row.statement ? `/dms/${encodeURIComponent(row.statement.documentId)}` : null;
            const serviceOpen = !bank && !row.confirmation;
            return (
              <TableRow key={row.accountId} data-testid="closing-statement-row" data-account={row.accountId}>
                <TableCell col="title">
                  <span className="block text-ink">{row.name}</span>
                  <span className="block text-meta text-muted-ink">{t(`kind.${row.kind}`)}</span>
                </TableCell>
                <TableCell col="status">{state.missing ? <StatusBadge tone="warning" dot>{t('missing')}</StatusBadge> : null}</TableCell>
                <TableCell col="meta" wrap>
                  {bank && row.statement?.covers && statementLink ? (
                    <Link href={statementLink} className="block text-link underline-offset-2 hover:underline">
                      {t('lies', { number: row.statement.documentNumber })}
                    </Link>
                  ) : state.text ? (
                    <span className="block text-ink-2">{state.text}</span>
                  ) : null}
                  {state.sub ? <span className="block text-muted-ink">{state.sub}</span> : null}
                </TableCell>
                <TableCell col="actions">
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {state.missing && canWriteStatement ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => open('file', row)} data-testid="closing-statement-file">
                        {t('file')}
                      </Button>
                    ) : null}
                    {serviceOpen && canConfirm ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => open('service', row)} data-testid="closing-statement-service">
                        {t('confirmService')}
                      </Button>
                    ) : null}
                    <RowMenu
                      name={row.name}
                      items={[
                        { key: 'file', label: t('file'), onSelect: () => open('file', row), hidden: !bank || !canWriteStatement },
                        { key: 'justify', label: t('justify'), onSelect: () => open('justify', row), hidden: !bank || !canConfirm || Boolean(row.statement?.covers) },
                        { key: 'open', label: t('openAccount'), href: `/finance/entries?year=${year}&account=${encodeURIComponent(row.accountId)}` },
                      ]}
                    />
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {canConfirm ? (
        <div className="flex flex-col gap-2.5">
          <label className="flex cursor-pointer items-start gap-2 text-body text-ink">
            <Checkbox checked={allFiled} onCheckedChange={(v) => setAllFiled(v === true)} className="mt-0.5" data-testid="closing-statements-all" />
            <span className="flex flex-col">
              {t('allFiled')}
              <span className="text-hint text-muted-ink">{t('allFiledHint')}</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button type="button" disabled={!allFiled || pending} onClick={() => void finish()} data-testid="closing-statements-finish">
              {t('finish')}
            </Button>
            {!allFiled ? <span className="text-meta text-muted-ink">{t('finishBlocked')}</span> : null}
          </div>
          <RefusalNotice state={feedback.state} />
        </div>
      ) : (
        <p className="text-meta text-muted-ink">{c('noRight')}</p>
      )}
      {dialog?.kind === 'file' ? <StatementDialog open onOpenChange={(o) => (o ? undefined : setDialog(null))} fiscalYearId={status.fiscalYearId} endsOn={status.endsOn} account={{ accountId: dialog.row.accountId, name: dialog.row.name, lastMovementOn: dialog.row.lastMovementOn, balanceAtYearEndCents: dialog.row.balanceAtYearEndCents }} /> : null}
      {dialog?.kind === 'justify' ? <JustifyDialog open onOpenChange={(o) => (o ? undefined : setDialog(null))} fiscalYearId={status.fiscalYearId} account={{ accountId: dialog.row.accountId, name: dialog.row.name }} /> : null}
      {dialog?.kind === 'service' ? <AccountConfirmDialog open onOpenChange={(o) => (o ? undefined : setDialog(null))} fiscalYearId={status.fiscalYearId} endsOn={status.endsOn} account={{ accountId: dialog.row.accountId, name: dialog.row.name, hasBalance: Boolean(dialog.row.importedBalance) }} /> : null}
    </div>
  );
}
