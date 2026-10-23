'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import type { BackupRow } from '@/lib/backup-view';
import { formatSize } from '@/lib/format-size';
import { deleteBackupAction, unpinBackupAction } from './actions';
import { useBackupDialog } from './backup-page-provider';
import { PinDialog } from './pin-dialog';
import { RestoreDialog } from './restore-dialog';
import { UploadDialog } from './upload-dialog';

/**
 * Die Dialoge der Backup-Seite, je Art genau eine Instanz, gesteuert über `useBackupDialog` (MUSTER § C, „Dialoge
 * gesteuert“): Der Menüeintrag öffnet nur; der Fokus geht danach an das ⋯ der Zeile zurück.
 */
export function BackupDialogs({
  rows,
  pinnedCount,
  pinnedMax,
  environmentName,
  appVersion,
  appMigrationCount,
}: {
  rows: BackupRow[];
  pinnedCount: number;
  pinnedMax: number;
  environmentName: string;
  appVersion: string;
  appMigrationCount: number;
}) {
  const t = useTranslations('backup');
  const fmt = useDateFormat();
  const { dialog, open, close } = useBackupDialog();
  if (!dialog) return null;
  if (dialog.kind === 'upload') return <UploadDialog onClose={close} onRestore={(name) => open({ kind: 'restore', name, returnFocus: null })} />;
  // Eine eben hochgeladene Datei erscheint erst mit dem neuen Stand der Seite in `rows`.
  const row = rows.find((r) => r.name === dialog.name);
  if (!row) return null;
  const finalFocus = { current: dialog.returnFocus };
  const when = fmt.dateTime(row.createdAt);
  switch (dialog.kind) {
    case 'restore':
      return <RestoreDialog row={row} environmentName={environmentName} appVersion={appVersion} appMigrationCount={appMigrationCount} onClose={close} finalFocus={finalFocus} />;
    case 'pin':
    case 'rename':
      return <PinDialog row={row} mode={dialog.kind} pinnedCount={pinnedCount} pinnedMax={pinnedMax} onClose={close} finalFocus={finalFocus} />;
    case 'unpin':
      return (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && close()}
          title={t('unpin.title')}
          description={t('unpin.text', { when })}
          confirmLabel={t('unpin.confirm')}
          destructive
          finalFocus={finalFocus}
          action={() => unpinBackupAction(row.name)}
        />
      );
    case 'delete':
      return (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && close()}
          title={t('delete.title')}
          description={t('delete.text', { when, kind: t(`list.kind.${row.kind}`, { version: row.appVersion ?? '' }), size: formatSize(row.sizeBytes) })}
          confirmLabel={t('delete.confirm')}
          destructive
          finalFocus={finalFocus}
          action={() => deleteBackupAction(row.name)}
        />
      );
  }
}
