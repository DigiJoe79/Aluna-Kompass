'use client';

import type { OutboxListItem } from '@kompass/module-dms';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { Empty } from '@/components/empty-value';
import { FilterBar, selectFilter } from '@/components/filter-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ListPager } from '@/components/list-pager';
import { RowMenu } from '@/components/row-menu';
import { StatusBadge, isNormalInList, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUrlFilters } from '@/lib/use-url-filters';
import { resendDocumentMailAction } from './actions';

const STATES = ['queued', 'sending', 'sent', 'failed', 'blocked', 'withdrawn'] as const;
const PERIODS = ['30', '90', '365'] as const;
type Filters = { state: string; period: string };

/**
 * Der Ausgang (Handoff 2b E4, 21a/21b): je Sendung Dokument (Nummer, Betreff darunter), Empfänger ohne Adresse, Zeit
 * und Zustand — „gesendet“ ist der Normalzustand ohne Marke, „nicht zugestellt“ nennt den Grund. Zeilenmenü
 * „Erneut senden“ (nur nicht zugestellt, nur mit `dms.send`) und „Dokument öffnen“. Neueste zuerst.
 */
export function OutboxList({ rows, total, unfiltered, offset, pageSize, canSend }: { rows: OutboxListItem[]; total: number; unfiltered: number; offset: number; pageSize: number; canSend: boolean }) {
  const t = useTranslations('dms.outbox');
  const tState = useTranslations('dispatchStep.state');
  const { dateTime } = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const feedback = useActionFeedback();
  const [filters, setFilters] = useUrlFilters<Filters>({ state: params.get('state') ?? '', period: params.get('period') ?? '' });

  const apply = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    const qs = new URLSearchParams();
    qs.set('outbox', '1');
    if (merged.state) qs.set('state', merged.state);
    if (merged.period) qs.set('period', merged.period);
    startTransition(() => router.replace(`${pathname}?${qs.toString()}`));
  };
  const reset = () => apply({ state: '', period: '' });
  const filtered = Boolean(filters.state || filters.period);

  return (
    <div className="flex flex-col gap-3" data-testid="outbox">
      <FilterBar
        filters={[
          selectFilter({ key: 'state', label: t('filterState'), value: filters.state, options: STATES.map((s) => ({ value: s, label: tState(s) })), onChange: (state) => apply({ state }) }),
          selectFilter({ key: 'period', label: t('filterPeriod'), value: filters.period, options: PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) })), onChange: (period) => apply({ period }) }),
        ]}
        onApply={(values) => apply(values as Partial<Filters>)}
        count={{ shown: total, total: unfiltered, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
        onReset={reset}
        testId="outbox-filters"
      />
      <RefusalNotice action state={feedback.state} />
      {rows.length === 0 && filtered ? (
        <EmptyState filtered={{ noun: t('filteredNoun'), onReset: reset }} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.document')}</TableHead>
                <TableHead col="meta">{t('columns.recipient')}</TableHead>
                <TableHead col="meta">{t('columns.time')}</TableHead>
                <TableHead col="status">{t('columns.state')}</TableHead>
                <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="outbox-row" data-status={row.status}>
                  <TableCell col="title">
                    <span className="flex flex-col">
                      <RowLink href={`/dms/${row.documentId}`}>{row.documentNumber ?? row.documentSubject}</RowLink>
                      <span className="text-hint text-muted-ink">{row.documentSubject}</span>
                    </span>
                  </TableCell>
                  <TableCell col="meta" className="text-ink-2">{row.contactName ?? <Empty />}</TableCell>
                  <TableCell col="meta" className="text-ink-2">{dateTime(row.sentAt ?? row.queuedAt)}</TableCell>
                  <TableCell col="status">
                    {isNormalInList('outbox', row.status) ? null : (
                      <span className="flex flex-col items-start gap-0.5">
                        <StatusBadge tone={statusTone('outbox', row.status)} dot>{tState(row.status)}</StatusBadge>
                        {/* Am Telefon nur die Marke (21b); der Grund steht am Dokument. */}
                        {row.status === 'failed' && (row.lastErrorText || row.lastErrorCode) ? (
                          <span className="text-hint text-muted-ink max-md:hidden">{[row.lastErrorText, row.lastErrorCode ? `(${row.lastErrorCode})` : null].filter(Boolean).join(' ')}</span>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell col="actions" className="text-right">
                    <RowMenu
                      name={row.documentNumber ?? row.documentSubject}
                      items={[
                        {
                          key: 'resend',
                          label: t('resend'),
                          hidden: !canSend || row.status !== 'failed',
                          onSelect: () => void feedback.run(() => resendDocumentMailAction(row.documentId, row.id)).then((result) => (result.status === 'success' ? router.refresh() : undefined)),
                        },
                        { key: 'open', label: t('open'), onSelect: () => router.push(`/dms/${row.documentId}`) },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPager
            total={total}
            offset={offset}
            pageSize={pageSize}
            hrefFor={(next) => {
              const qs = new URLSearchParams(params.toString());
              const target = Math.floor(next / pageSize) + 1;
              if (target > 1) qs.set('page', String(target));
              else qs.delete('page');
              return `${pathname}?${qs.toString()}`;
            }}
            footer
            testId="outbox-pager"
          />
        </div>
      )}
    </div>
  );
}
