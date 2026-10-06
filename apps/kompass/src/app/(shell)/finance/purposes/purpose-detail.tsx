'use client';

import type { PurposeMovementLine, PurposeOverviewRow } from '@kompass/module-finance';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { fulfillPurposeAction, purposeMovementsAction, reopenPurposeAction } from './actions';
import { ReopenDialog } from './reopen-dialog';

/**
 * Detail eines Zwecks (Designer-README 4c): Kopf mit Projekt, Ziel und Bezug;
 * „Zweck ändern (Umwidmung)“, „Als erfüllt kennzeichnen“ (mit Rest-Warnung),
 * Menü „Wieder öffnen …“ (`finance.setup`); Bewegungen mit laufendem Stand:
 * Datum · Buchung (Nummer mit Link) · Text · Spender/Empfänger · Betrag ·
 * Stand (Designer-README 4c).
 * Nur mit `finance.read` — die Bewegungen prüft der Dienst.
 */
export function PurposeDetail({
  row,
  projectName,
  canTransfer,
  canSetup,
}: {
  row: PurposeOverviewRow;
  projectName: string | null;
  canTransfer: boolean;
  canSetup: boolean;
}) {
  const t = useTranslations('finance.purposes');
  const fmt = useDateFormat();
  const router = useRouter();
  const [movements, setMovements] = useState<PurposeMovementLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFulfill, setConfirmFulfill] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [pending, setPending] = useState(false);
  const fulfillFb = useActionFeedback();

  useEffect(() => {
    let cancelled = false;
    void purposeMovementsAction(row.id).then((res) => {
      if (cancelled) return;
      if ('error' in res) setError(res.error);
      else setMovements(res.movements);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, row.balanceCents]);

  const fulfill = async () => {
    setPending(true);
    const result = await fulfillFb.run(() => fulfillPurposeAction(row.id, row.updatedAt ?? ''), { retry: () => void fulfill() });
    setPending(false);
    setConfirmFulfill(false);
    if (result.status !== 'success') return;
    toast.success(t('detail.fulfilled'));
    router.refresh();
  };

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-5" data-testid="purpose-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-[18px] text-ink">{row.name}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
            <dt className="text-muted-ink">{t('detail.project')}</dt>
            <dd className="text-ink">{projectName ?? '—'}</dd>
            <dt className="text-muted-ink">{t('detail.target')}</dt>
            <dd className="font-mono tabular-nums text-ink">{row.targetCents !== null ? formatEuro(row.targetCents) : t('detail.noTarget')}</dd>
            {row.referenceNote ? (
              <>
                <dt className="text-muted-ink">{t('detail.reference')}</dt>
                <dd className="text-ink">{row.referenceNote}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canTransfer ? (
            <Link href={`/finance/purposes/transfer?from=${row.id}`} className={buttonVariants({ variant: 'outline' })} data-testid="purpose-transfer">
              {t('detail.transfer')}
            </Link>
          ) : null}
          {canSetup && row.state === 'open' ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => (row.balanceCents > 0 ? setConfirmFulfill(true) : void fulfill())} data-testid="purpose-fulfill">
              {t('detail.fulfill')}
            </Button>
          ) : null}
          {canSetup && row.state !== 'open' ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label={t('detail.menu')} data-testid="purpose-menu">
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="bg-surface shadow-md">
                <DropdownMenuItem onSelect={() => setReopening(true)} data-testid="purpose-reopen">
                  {t('detail.reopen')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <RefusalNotice action state={fulfillFb.state} />

      {confirmFulfill ? (
        <Notice level="hint">
          <div className="space-y-2" data-testid="purpose-fulfill-confirm">
            <p>{t('detail.fulfillConfirm', { amount: formatEuro(row.balanceCents) })}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => void fulfill()} data-testid="purpose-fulfill-confirm-button">
                {t('detail.fulfillConfirmButton')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmFulfill(false)}>
                {t('reopenDialog.cancel')}
              </Button>
            </div>
          </div>
        </Notice>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-[.04em] text-muted-ink">{t('detail.movements')}</h3>
        {error ? (
          <p className="text-[13px] text-error">{error}</p>
        ) : movements === null ? (
          <p className="text-[13px] text-muted-ink">{t('detail.movementsLoading')}</p>
        ) : movements.length === 0 ? (
          <p className="text-[13px] text-muted-ink">{t('detail.movementsEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <Table data-testid="purpose-movements">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3">{t('detail.movementColumns.date')}</TableHead>
                  <TableHead className="px-3">{t('detail.movementColumns.entry')}</TableHead>
                  <TableHead className="px-3">{t('detail.movementColumns.text')}</TableHead>
                  <TableHead className="px-3">{t('detail.movementColumns.counterparty')}</TableHead>
                  <TableHead className="px-3 text-right">{t('detail.movementColumns.amount')}</TableHead>
                  <TableHead className="px-3 text-right">{t('detail.movementColumns.running')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m, i) => (
                  <TableRow key={`${m.kind}-${m.entryId ?? m.transferId ?? 'cf'}-${i}`}>
                    <TableCell className="px-3 text-ink-2">{fmt.date(m.date)}</TableCell>
                    <TableCell className="px-3 font-mono text-[12px]">
                      {m.kind === 'line' && m.entryId ? (
                        <Link href={`/finance/entries/${m.entryId}`} className="underline-offset-2 hover:underline">
                          {m.entryNumber ?? '—'}
                        </Link>
                      ) : (
                        <span className="text-muted-ink">{m.transferNumber ?? '—'}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 text-ink">{m.kind === 'line' ? m.text : m.text ? `${t(`movementKind.${m.kind}`)}: ${m.text}` : t(`movementKind.${m.kind}`)}</TableCell>
                    <TableCell className="px-3 text-ink-2">{m.counterpartyName ?? '—'}</TableCell>
                    <TableCell className="px-3 text-right font-mono tabular-nums">{formatEuro(m.amountCents)}</TableCell>
                    <TableCell className="px-3 text-right font-mono tabular-nums">{formatEuro(m.runningBalanceCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {reopening ? <ReopenDialog
          name={row.name}
          onClose={() => setReopening(false)}
          onConfirm={(reason) => reopenPurposeAction(row.id, row.updatedAt ?? '', reason)}
          onDone={() => {
            setReopening(false);
            toast.success(t('detail.reopened'));
            router.refresh();
          }}
        /> : null}
    </section>
  );
}
