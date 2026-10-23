import { backupJobStatus, hasPermission, isoDayInZone, listBackupArchives, NIGHTLY_GRACE_MINUTES, readSetting, requirePermission, timeZoneOf } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { PanelNav, panelFromQuery } from '@/components/panel-nav';
import { backupJobView, type BackupJobView } from '@/lib/backup-job-view';
import { backupHeadline, toBackupRow, visibleBackups } from '@/lib/backup-view';
import { appVersion } from '@/lib/build';
import { runtimeEnv } from '@/lib/deps';
import { environmentConfirmationName } from '@/lib/env-banner';
import { requireSession } from '@/lib/request-context';
import { BackupDialogs } from './backup-dialogs';
import { BackupHeader } from './backup-header';
import { BackupList } from './backup-list';
import { BackupNotices, RestoredNotice, StorageLowNotice } from './backup-notices';
import { BackupPageProvider } from './backup-page-provider';
import { BackupSettingsForm } from './backup-settings-form';
import { BackupLastResult, BackupRunCard } from './backup-run-card';

const PANELS = ['backups', 'settings'] as const;
const DAY_MS = 86_400_000;

/** Den Hinweis nach dem Einspielen sieht nur die einspielende Person, und nur am ersten Tag danach (Planer: „einmal“ ohne eigenen Merker). */
function restoreHintOf(view: BackupJobView, userId: string | null, now: Date) {
  const last = view.last.restore;
  if (!last?.restore || !userId || last.userId !== userId) return null;
  return now.getTime() - Date.parse(last.finishedAt) < DAY_MS ? last.restore : null;
}

/**
 * System › Backup (Designer 2026-10-23): Zustand als Satz im Kopf, Reiter „Backups“ und „Einstellungen“. Die Liste
 * kommt vom Server; den Laufstand fragt der Provider über `/admin/backup/job` ab.
 */
export default async function BackupPage({ searchParams }: { searchParams: Promise<{ panel?: string; all?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'backup.export')) return <Page width="standard"><ForbiddenCard permission="backup.export" /></Page>;
  const t = await getTranslations('backup');
  const sp = await searchParams;
  const panel = panelFromQuery(sp.panel, PANELS, 'backups');
  const overview = await listBackupArchives(deps, ctx, {});
  if (!overview.ok) {
    return (
      <Page width="standard" header={<PageHeader title={t('title')} />}>
        <BlockedState step={t('title')} title={t('errors.backupPathMissing.reason')}>
          {t('errors.backupPathMissing.remedy')}
        </BlockedState>
      </Page>
    );
  }
  const status = await backupJobStatus(deps, ctx, {});
  const now = deps.clock.now();
  const view: BackupJobView = status.ok ? backupJobView(deps, status.value, await getTranslations(), now) : { running: null, last: { create: null, verify: null, restore: null } };
  const o = overview.value;
  const rows = o.items.map(toBackupRow);
  const timeZone = timeZoneOf(deps);
  const visible = visibleBackups(rows, { today: isoDayInZone(now, timeZone), timeZone, showAll: sp.all === '1' });
  const headline = backupHeadline({ rows, lastError: o.lastError, nightlyMissing: o.nightlyMissing, running: view.running !== null });
  const canImport = hasPermission(ctx, 'backup.import');
  const lastCreate = view.last.create;
  const lastDurationMs = lastCreate?.status === 'success' ? Date.parse(lastCreate.finishedAt) - Date.parse(lastCreate.startedAt) : null;
  const restoreHint = restoreHintOf(view, ctx.userId, now);
  return (
    <BackupPageProvider initial={view}>
      <Page width="standard" header={<BackupHeader headline={headline} schedule={o.schedule} canImport={canImport} />}>
        <div className="flex flex-col gap-5">
          <PanelNav basePath="/admin/backup" panels={PANELS} active={panel} labels={{ backups: t('panels.backups'), settings: t('panels.settings') }} ariaLabel={t('panels.label')} />
          {panel === 'backups' ? (
            <>
              {restoreHint ? <RestoredNotice hint={restoreHint} /> : null}
              <BackupNotices headline={headline} lastError={o.lastError} schedule={o.schedule} mailAvailable={o.mailAvailable} mountWarning={o.mountWarning} graceMinutes={NIGHTLY_GRACE_MINUTES} />
              <BackupRunCard lastDurationMs={lastDurationMs} />
              <BackupLastResult newestCreatedAt={rows[0]?.createdAt ?? null} />
              <StorageLowNotice storage={o.storage} />
              <BackupList
                rows={rows}
                shown={visible.shown}
                hidden={visible.hidden}
                total={visible.total}
                storage={o.storage}
                pinnedMax={o.pinnedMax}
                canImport={canImport}
                canAudit={hasPermission(ctx, 'audit.view')}
                appMigrationCount={deps.migrationCount}
              />
            </>
          ) : (
            <BackupSettingsForm
              values={{
                enabled: o.schedule.enabled,
                time: o.schedule.time,
                daily: readSetting<number>(deps, 'backup.ring.daily'),
                weekly: readSetting<number>(deps, 'backup.ring.weekly'),
                monthly: readSetting<number>(deps, 'backup.ring.monthly'),
                maxAgeDays: readSetting<number>(deps, 'backup.maxAgeDays'),
                agentAllowed: readSetting<boolean>(deps, 'backup.mcpHumanOnlyAllowed'),
              }}
              referenceBytes={o.storage?.referenceBytes ?? null}
              mailAvailable={o.mailAvailable}
              canManage={hasPermission(ctx, 'settings.manage')}
            />
          )}
        </div>
        <BackupDialogs
          rows={rows}
          pinnedCount={rows.filter((r) => r.pinned).length}
          pinnedMax={o.pinnedMax}
          environmentName={environmentConfirmationName(runtimeEnv().env)}
          appVersion={appVersion()}
          appMigrationCount={deps.migrationCount}
        />
      </Page>
    </BackupPageProvider>
  );
}
