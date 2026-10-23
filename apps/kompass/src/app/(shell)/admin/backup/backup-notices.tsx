'use client';

import type { BackupMountWarning, BackupProblem, BackupStorage } from '@kompass/core';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import type { HeadlineState } from '@/lib/backup-view';
import { formatSize } from '@/lib/format-size';
import { useStartBackup } from './backup-header';
import { useBackupJob } from './backup-page-provider';

const TITLED = ['createFailed', 'verifyFailed', 'pruneFailed', 'interrupted', 'preUpdateFailed', 'backupPathUnwritable'] as const;
const KNOWN_REASONS = new Set([
  'backupFormatUnsupported',
  'backupUnreadable',
  'backupFileMissing',
  'backupFileSizeMismatch',
  'backupCorrupt',
  'backupChecksumMismatch',
  'writeFailed',
  'cancelled',
  'timeout',
  'interrupted',
]);

/** „03:00“ plus Minuten, als Uhrzeit des Zeitplans (Vereinszeit, ohne Datum). */
export function plusMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Hinweis nach dem Einspielen, nur für die einspielende Person am ersten Tag (Designer § 5). */
export function RestoredNotice({ hint }: { hint: { backupCreatedAt: string; publishedSinceBackup: boolean } }) {
  const t = useTranslations('backup');
  const fmt = useDateFormat();
  return (
    <Notice level="hint">
      {t('restored.text', { when: fmt.dateTime(hint.backupCreatedAt) })}
      {hint.publishedSinceBackup ? (
        <>
          {' '}
          {t('restored.published')}{' '}
          <Link href="/site/publish" className="underline">
            {t('restored.publish')}
          </Link>
        </>
      ) : null}
    </Notice>
  );
}

/**
 * Warnungen über der Liste (Designer 1a–1e, Nachtrag 6c) in fester Reihenfolge: das letzte Problem („gescheitert“ vor
 * „fehlt“, nie beide; läuft ein Backup, ersetzt die RunCard „fehlt“), dann das nicht eingehängte Verzeichnis. Die
 * Platzwarnung steht über der Liste selbst (`StorageLowNotice`).
 */
export function BackupNotices({
  headline,
  lastError,
  schedule,
  mailAvailable,
  mountWarning,
  graceMinutes,
}: {
  headline: HeadlineState;
  lastError: BackupProblem | null;
  schedule: { enabled: boolean; time: string };
  mailAvailable: boolean;
  mountWarning: BackupMountWarning;
  /** Wie lange nach der Uhrzeit ein nächtliches Backup als fehlend gilt (`NIGHTLY_GRACE_MINUTES`, vom Server). */
  graceMinutes: number;
}) {
  const t = useTranslations('backup');
  const { running } = useBackupJob();
  const { start, pending, state } = useStartBackup();
  const notice = headline.notice === 'nightlyMissing' && running ? null : headline.notice;
  return (
    <>
      {notice === 'failed' && lastError ? (
        <Notice level="warn" title={t(`problem.title.${(TITLED as readonly string[]).includes(lastError.code) ? lastError.code : 'createFailed'}`, { kind: lastError.kind ?? 'other' })}>
          {[
            lastError.reason && KNOWN_REASONS.has(lastError.reason) ? t(`reasons.${lastError.reason}`) : null,
            lastError.kind === 'automatic' && schedule.enabled ? t('problem.retry', { time: schedule.time }) : null,
            mailAvailable ? (lastError.mailed ? t('problem.mailed') : null) : t('problem.noMail'),
          ]
            .filter(Boolean)
            .join(' ')}
        </Notice>
      ) : null}
      {notice === 'nightlyMissing' ? (
        <Notice
          level="warn"
          title={t('missing.title')}
          action={
            <div className="flex flex-col gap-2">
              <RefusalNotice action state={state} />
              <div>
                <Button variant="outline" size="sm" disabled={pending} onClick={start}>
                  {t('missing.action')}
                </Button>
              </div>
            </div>
          }
        >
          {t('missing.text', { time: schedule.time, until: plusMinutes(schedule.time, graceMinutes) })}
        </Notice>
      ) : null}
      {mountWarning === 'notMounted' ? (
        <Notice level="warn" title={t('mount.title')}>
          {t('mount.text')}
        </Notice>
      ) : null}
    </>
  );
}

/** Platz wird knapp: über der Liste, bevor das nächste Backup scheitert (Designer § 6). */
export function StorageLowNotice({ storage }: { storage: BackupStorage | null }) {
  const t = useTranslations('backup');
  if (!storage?.low || storage.referenceBytes === null) return null;
  return (
    <Notice level="warn" title={t('storageLow.title')}>
      {t('storageLow.text', { free: formatSize(storage.freeBytes), reference: formatSize(storage.referenceBytes) })}
    </Notice>
  );
}
