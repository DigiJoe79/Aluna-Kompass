'use client';

import type { BackupStorage } from '@kompass/core';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ListTruncated } from '@/components/list-truncated';
import { RowMenu, type RowMenuItem } from '@/components/row-menu';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ActionState } from '@/lib/actions';
import { retentionMessage, rowActions, type BackupRow, type RowAction } from '@/lib/backup-view';
import { countParts } from '@/lib/count-parts';
import { toastUndo } from '@/lib/feedback';
import { formatSize } from '@/lib/format-size';
import { cn } from '@/lib/utils';
import { pinBackupAction, unpinBackupAction, verifyBackupAction } from './actions';
import { useBackupDialog, useBackupJob } from './backup-page-provider';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Download über die Datei-Route (kein `Link`: der würde die Datei vorladen). Den Fortschritt zeigt der Browser; der
 * Toast sagt das (Designer § 4).
 */
export function startDownload(name: string, sizeLabel: string, t: Translate): void {
  window.location.assign(`/admin/backup/files/${encodeURIComponent(name)}`);
  toast.success(t('download.title', { size: sizeLabel }), { description: t('download.text'), duration: 8000 });
}

const COLUMNS = 7;

function BackupListRow({
  row,
  ctx,
}: {
  row: BackupRow;
  ctx: Parameters<typeof rowActions>[1] & { pinnedMax: number; onRefusal: (fn: () => Promise<ActionState>) => void };
}) {
  const t = useTranslations('backup');
  const c = useTranslations('common');
  const fmt = useDateFormat();
  const trigger = useRef<HTMLButtonElement>(null);
  const { open } = useBackupDialog();
  const { track } = useBackupJob();
  const when = fmt.dateTime(row.createdAt);
  const size = formatSize(row.sizeBytes);
  const keep = retentionMessage(row.retention, row.kind);
  const failed = row.verification.status === 'failed' ? row.verification : null;
  const dialog = (kind: 'restore' | 'pin' | 'rename' | 'unpin' | 'delete') => open({ kind, name: row.name, returnFocus: trigger.current });
  const run: Record<RowAction, () => void> = {
    restore: () => dialog('restore'),
    download: () => startDownload(row.name, size, t as Translate),
    pin: () => dialog('pin'),
    rename: () => dialog('rename'),
    unpin: () => {
      if (row.dropsWhenUnpinned) return dialog('unpin');
      ctx.onRefusal(async () => {
        const state = await unpinBackupAction(row.name);
        if (state.status === 'success') toastUndo(t('unpin.done'), () => pinBackupAction({ name: row.name, label: row.pinnedLabel ?? undefined }), { undo: c('undo'), network: c('network') });
        return state;
      });
    },
    verify: () =>
      ctx.onRefusal(async () => {
        const state = await verifyBackupAction(row.name);
        if (state.status === 'success') track((state.data as { runId: string }).runId);
        return state;
      }),
    audit: () => {},
    delete: () => dialog('delete'),
  };
  const items: RowMenuItem[] = rowActions(row, ctx).map(({ action, hidden, disabledReason }) => ({
    key: action,
    label: action === 'download' ? t('menu.download', { size }) : t(`menu.${action}`),
    hidden,
    kind: action === 'delete' ? 'delete' : 'action',
    disabledReason: disabledReason ? t(`menu.reasons.${disabledReason}`, { max: ctx.pinnedMax }) : undefined,
    ...(action === 'audit' ? { href: `/admin/audit?text=${encodeURIComponent(row.name)}` } : { onSelect: run[action] }),
    testId: `backup-menu-${action}`,
  }));
  return (
    <TableRow data-backup={row.name}>
      <TableCell col="title">
        <span className="flex flex-col">
          <span className="tabular-nums">{when}</span>
          {row.pinnedLabel ? <span className="text-body text-ink-2">{row.pinnedLabel}</span> : null}
        </span>
      </TableCell>
      <TableCell col="meta" className="text-ink-2">
        {t(`list.kind.${row.kind}`, { version: row.appVersion ?? '' })}
      </TableCell>
      <TableCell col="meta" className="tabular-nums text-ink-2">
        {size}
      </TableCell>
      {/* Vor Update trägt das Manifest die neue Fassung — die alte kennt Kompass nicht; die Art nennt sie. In der
          Kartenzeile fehlt der Spaltenkopf, dort sagen „Kompass“ und „bleibt“, was der Wert ist (Designer 2a). */}
      <TableCell col="meta" className="tabular-nums text-ink-2">
        {row.kind === 'preUpdate' || !row.appVersion ? (
          <Empty />
        ) : (
          // Die Kartenzeile ist ein Flex-Behälter und schluckt ein Leerzeichen am Ende des Präfixes; deshalb ein festes
          // Leerzeichen, und die Version bricht nicht am Bindestrich („0.3.2-“ / „dev“).
          <span className="whitespace-nowrap">
            <span className="md:hidden">{t('list.versionPrefix')}{'\u00a0'}</span>
            {row.appVersion}
          </span>
        )}
      </TableCell>
      <TableCell col="meta" wrap className="text-ink-2">
        {keep.key === 'pinned' ? (
          <StatusBadge tone="neutral">{t('list.keep.pinned')}</StatusBadge>
        ) : (
          <>
            {keep.key === 'prune' ? null : <span className="md:hidden">{t('list.keepPrefix')}{'\u00a0'}</span>}
            {t(`list.keep.${keep.key}`, { until: keep.until ? fmt.date(keep.until) : '', kind: keep.kind ?? 'other' })}
          </>
        )}
      </TableCell>
      {/* „Geprüft“ ist der Normalzustand ohne Marke (N3, `NORMAL_IN_LIST.backupCheck`). */}
      <TableCell col="status">
        {failed ? (
          <span className="flex flex-col items-start gap-0.5">
            <StatusBadge tone={statusTone('backupCheck', 'failed')} dot>
              {t('list.checkFailed')}
            </StatusBadge>
            <span className="text-meta text-ink-2">{t(`reasons.${failed.reason}`)}</span>
          </span>
        ) : null}
      </TableCell>
      <TableCell col="actions">
        <RowMenu name={when} items={items} triggerRef={trigger} testId={`backup-row-menu-${row.name}`} />
      </TableCell>
    </TableRow>
  );
}

/**
 * Die Liste der Backups (Designer 1a, 2a): Zeitpunkt · Art · Größe · Version · Bleibt · Prüfung · Menü. „Geprüft“ ist
 * der Normalfall und bleibt leer. Im Fuß „Ältere: … · Alle n anzeigen“ und die Speicherzeile.
 */
export function BackupList({
  rows,
  shown,
  hidden,
  total,
  storage,
  pinnedMax,
  canImport,
  canAudit,
  appMigrationCount,
}: {
  rows: BackupRow[];
  shown: BackupRow[];
  hidden: { weekly: number; monthly: number; other: number };
  total: number;
  storage: BackupStorage | null;
  pinnedMax: number;
  canImport: boolean;
  canAudit: boolean;
  appMigrationCount: number;
}) {
  const t = useTranslations('backup');
  const { running } = useBackupJob();
  const feedback = useActionFeedback();
  const ctx = {
    running: running !== null,
    pinnedCount: rows.filter((r) => r.pinned).length,
    pinnedMax,
    newestVerifiedName: rows.find((r) => r.verification.status === 'passed')?.name ?? null,
    canImport,
    canAudit,
    appMigrationCount,
    onRefusal: (fn: () => Promise<ActionState>) => void feedback.run(fn),
  };
  const parts = countParts([
    [hidden.weekly, t('list.olderParts.weekly', { count: hidden.weekly })],
    [hidden.monthly, t('list.olderParts.monthly', { count: hidden.monthly })],
    [hidden.other, t('list.olderParts.other', { count: hidden.other })],
  ]);
  const fits = storage?.referenceBytes ? Math.floor(storage.freeBytes / storage.referenceBytes) : 0;
  const storageLine = storage
    ? storage.low
      ? t('list.storageLow', { used: formatSize(storage.usedBytes), free: formatSize(storage.freeBytes), fits })
      : t('list.storage', { used: formatSize(storage.usedBytes), free: formatSize(storage.freeBytes) })
    : null;
  return (
    <section className="overflow-clip rounded-lg border border-line bg-surface">
      <div className="p-5 max-sm:p-4">
        <Section title={t('list.title')} intro={t('list.intro')}>
          <div className="flex flex-col gap-3">
            <RefusalNotice action state={feedback.state} />
            <Table aria-label={t('list.title')}>
              <TableHeader>
                <TableRow>
                  <TableHead col="title">{t('list.columns.when')}</TableHead>
                  <TableHead col="meta">{t('list.columns.kind')}</TableHead>
                  <TableHead col="meta">{t('list.columns.size')}</TableHead>
                  <TableHead col="meta">{t('list.columns.version')}</TableHead>
                  {/* `wrap`: steht in der Kartenzeile in eigener Zeile und belegt keinen der drei meta-Plätze. */}
                  <TableHead col="meta" wrap>
                    {t('list.columns.keep')}
                  </TableHead>
                  <TableHead col="status">{t('list.columns.check')}</TableHead>
                  <TableHead col="actions">
                    <span className="sr-only">{t('list.columns.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 ? <TableEmpty colSpan={COLUMNS}>{t('list.empty')}</TableEmpty> : shown.map((row) => <BackupListRow key={row.name} row={row} ctx={ctx} />)}
              </TableBody>
            </Table>
          </div>
        </Section>
      </div>
      {shown.length < total || storageLine ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-2.5 text-meta" data-testid="backup-list-footer">
          <ListTruncated
            shown={shown.length}
            total={total}
            testId="backup-list-truncated"
            text={
              <>
                {t('list.older', { parts })} · <Link href="/admin/backup?all=1" className="underline">{t('list.showAll', { total })}</Link>
              </>
            }
          />
          {storageLine ? <span className={cn(storage?.low ? 'font-semibold text-warning' : 'text-muted-ink')}>{storageLine}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
