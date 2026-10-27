'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { JustifyDialog } from '../justify-dialog';
import type { ClosingStepBody, FactsOf } from '../step-body';

type CashRow = FactsOf<'cash'>['accounts'][number];

/**
 * Schritt 2 (Board 14a): eine Zeile je Kasse, wie die Konten in Schritt 1. Gilt eine spätere Zählung, weil sie ohne
 * Differenz ist, rechnet Kompass auf den Stichtag zurück, und „Bestätigen …“ an der Zeile öffnet den Dialog mit
 * Begründung (`cashRecomputed`). Mit Differenz gibt es nichts zu bestätigen: Marke, Satz mit Betrag, „Zur Kasse ›“.
 * Erledigt ist der Schritt, sobald jede Kasse stimmt oder bestätigt ist, ohne eigenen Knopf.
 */
export function CashStep({ step, status, canConfirm }: ClosingStepBody<'cash'>) {
  const t = useTranslations('finance.closing.cash');
  const c = useTranslations('finance.closing');
  const fmt = useDateFormat();
  const end = fmt.date(status.endsOn);
  const [confirming, setConfirming] = useState<CashRow | null>(null);
  const accounts = step.facts.accounts;

  const sentence = (a: CashRow): { text: string; differs: boolean; action: 'confirm' | 'cash' | null } => {
    if (a.count) {
      const amount = formatEuro(a.count.countedCents);
      return a.count.differenceCents === 0
        ? { text: t('rowCounted', { date: fmt.date(a.count.countedOn), amount }), differs: false, action: null }
        : { text: t('rowCountedDiffers', { date: fmt.date(a.count.countedOn), amount, difference: formatEuro(a.count.differenceCents, { sign: 'always' }) }), differs: false, action: null };
    }
    if (a.later && a.later.differenceCents !== 0) return { text: t('laterDiffers', { date: fmt.date(a.later.countedOn), amount: formatEuro(Math.abs(a.later.differenceCents)) }), differs: true, action: 'cash' };
    if (a.later) return { text: t('reckoned', { date: fmt.date(a.later.countedOn), end, amount: formatEuro(a.later.bookCentsAtEnd) }), differs: false, action: a.confirmation ? null : 'confirm' };
    return { text: t('rowNotCounted'), differs: false, action: 'cash' };
  };

  const needsRight = accounts.some((a) => sentence(a).action === 'confirm') && !canConfirm;

  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-cash">
      <p className="text-meta text-ink-2">{t('intro', { date: end })}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('columns.box')}</TableHead>
            <TableHead col="status">
              <span className="sr-only">{t('columns.state')}</span>
            </TableHead>
            <TableHead col="meta" wrap>
              {t('columns.state')}
            </TableHead>
            <TableHead col="actions">
              <span className="sr-only">{t('columns.action')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a) => {
            const s = sentence(a);
            return (
              <TableRow key={a.accountId} data-testid="closing-cash-row">
                <TableCell col="title">{a.name}</TableCell>
                <TableCell col="status">{s.differs ? <StatusBadge tone="warning" dot>{t('difference')}</StatusBadge> : null}</TableCell>
                <TableCell col="meta" wrap>
                  <span className="block text-ink-2">{s.text}</span>
                  {a.confirmation ? <span className="block text-muted-ink">{t('confirmedNote', { note: a.confirmation.note ?? '' })}</span> : null}
                </TableCell>
                <TableCell col="actions">
                  {s.action === 'confirm' && canConfirm ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(a)} data-testid="closing-cash-confirm">
                      {c('confirm')}
                    </Button>
                  ) : s.action === 'cash' && status.me.canCount ? (
                    <Link href="/finance/cash" className="whitespace-nowrap text-link underline-offset-2 hover:underline">
                      {t('toCash')}
                    </Link>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {needsRight ? <p className="text-meta text-muted-ink">{c('noRight')}</p> : null}
      {confirming ? <JustifyDialog open onOpenChange={(o) => (o ? undefined : setConfirming(null))} fiscalYearId={status.fiscalYearId} account={{ accountId: confirming.accountId, name: confirming.name }} kind="cashRecomputed" endsOn={status.endsOn} /> : null}
    </div>
  );
}
