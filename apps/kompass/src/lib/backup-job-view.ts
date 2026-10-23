import { userNamesFor, type AppDeps, type BackupCreateResult, type BackupJobKind, type BackupJobStatus, type JobMeta, type JobRecord, type JobSource, type JobStep, type RestoreResult } from '@kompass/core';
import { viewError, type ViewError } from './site-job-view';

/*
 * Was `/admin/backup/job` an den Browser gibt (Plan U2): der laufende Lauf mit Person und verstrichener Zeit, je Art
 * das letzte Ergebnis — gekürzt auf den Namen des Backups bzw. die Felder des Einspielens. Kein `result`: Das Ergebnis
 * eines Backups trägt die Begleitdatei samt Manifest und Dateiliste (über 1.600 Einträge bei Aluna).
 */

export interface BackupRunView {
  runId: string;
  kind: BackupJobKind;
  source: JobSource;
  startedAt: string;
  elapsedMs: number;
  userName: string | null;
  cancellable: boolean;
  steps: JobStep[];
  meta: JobMeta;
}

export interface BackupRecordView {
  runId: string;
  kind: BackupJobKind;
  status: JobRecord['status'];
  reason?: 'cancelled' | 'timeout';
  startedAt: string;
  finishedAt: string;
  userId: string | null;
  lastStep: string | null;
  meta: JobMeta;
  error?: ViewError;
  name: string | null;
  restore?: { backupCreatedAt: string; publishedSinceBackup: boolean };
}

export interface BackupJobView {
  running: BackupRunView | null;
  last: Record<BackupJobKind, BackupRecordView | null>;
}

type Translate = Parameters<typeof viewError>[1];

const metaName = (meta: JobMeta): string | null => (typeof meta.name === 'string' ? meta.name : null);

function recordView(kind: BackupJobKind, record: JobRecord | null, t: Translate): BackupRecordView | null {
  if (!record) return null;
  const name = kind === 'create' ? ((record.result as BackupCreateResult | undefined)?.name ?? metaName(record.meta)) : metaName(record.meta);
  const restored = kind === 'restore' && record.status === 'success' ? (record.result as RestoreResult | undefined) : undefined;
  return {
    runId: record.runId,
    kind,
    status: record.status,
    ...(record.reason ? { reason: record.reason } : {}),
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    userId: record.userId,
    lastStep: record.lastStep ?? null,
    meta: record.meta,
    ...(record.error ? { error: viewError(record.error, t) } : {}),
    name,
    ...(restored ? { restore: { backupCreatedAt: restored.backupCreatedAt, publishedSinceBackup: restored.publishedSinceBackup } } : {}),
  };
}

export function backupJobView(deps: AppDeps, status: BackupJobStatus, t: Translate, now: Date): BackupJobView {
  const run = status.running;
  const names = userNamesFor(deps, [run?.userId]);
  return {
    running: run
      ? {
          runId: run.runId,
          kind: run.kind as BackupJobKind,
          source: run.source,
          startedAt: run.startedAt,
          elapsedMs: Math.max(0, now.getTime() - Date.parse(run.startedAt)),
          userName: run.userId ? (names.get(run.userId) ?? null) : null,
          cancellable: run.cancellable,
          steps: run.steps,
          meta: run.meta,
        }
      : null,
    last: {
      create: recordView('create', status.last.create, t),
      verify: recordView('verify', status.last.verify, t),
      restore: recordView('restore', status.last.restore, t),
    },
  };
}
