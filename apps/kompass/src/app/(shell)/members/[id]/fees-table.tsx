'use client';

import type { FeeView } from '@kompass/module-members';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { StatusBadge, isNormalInList, statusTone } from '@/components/status-badge';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';

/**
 * Nebenliste „Beiträge“ am Mitglied (Handoff Mitglieder D1, D8, 3c): Jahr (Zeitraum) · Fällig · Betrag · Bezahlt am · Zustand.
 * Die Mahnstufe ersetzt „überfällig“; offen und bezahlt stehen ohne Marke. Wer die Finanzen lesen darf, öffnet über das
 * Jahr das Seitenfenster der offenen Zahlung (098) — es hängt an `?item=` wie in der Liste der offenen Zahlungen.
 */
export function FeesTable({ fees, levels, canOpen }: { fees: FeeView[]; levels: { key: string; name: string; last: boolean }[]; canOpen: boolean }) {
  const t = useTranslations('members.detail');
  const { date } = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = (itemId: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('item', itemId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('columns.year')}</TableHead>
            <TableHead col="meta">{t('columns.due')}</TableHead>
            <TableHead col="amount" className="text-right">{t('columns.amount')}</TableHead>
            <TableHead col="meta">{t('columns.paidOn')}</TableHead>
            <TableHead col="status">{t('columns.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fees.map((f) => {
            const level = f.dunningLevel ? levels.find((l) => l.key === f.dunningLevel) : undefined;
            return (
              <TableRow key={f.chargeId} data-testid="member-fee-row">
                <TableCell col="title">
                  {canOpen && f.openItemId ? (
                    <RowButton aria-haspopup="dialog" aria-label={t('openItem', { period: f.period })} onClick={() => open(f.openItemId!)} className="tabular-nums">{f.period}</RowButton>
                  ) : (
                    <span className="tabular-nums">{f.period}</span>
                  )}
                </TableCell>
                <TableCell col="meta" className="text-ink-2">{date(f.dueOn)}</TableCell>
                <TableCell col="amount" className="text-right tabular-nums text-ink">{formatEuro(f.amountCents)}</TableCell>
                <TableCell col="meta" className="text-ink-2">{f.paidOn ? date(f.paidOn) : <Empty />}</TableCell>
                <TableCell col="status">
                  {!isNormalInList('fee', f.state) || level || f.overdue ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {isNormalInList('fee', f.state) ? null : <StatusBadge tone={statusTone('fee', f.state)} dot>{t(`feeState.${f.state}`)}</StatusBadge>}
                      {level ? (
                        <StatusBadge tone={statusTone('dunning', level.last ? 'lastLevel' : 'level')} dot>{level.name}</StatusBadge>
                      ) : f.overdue ? (
                        <StatusBadge tone={statusTone('fee', 'overdue')} dot>{t('feeState.overdue')}</StatusBadge>
                      ) : null}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
