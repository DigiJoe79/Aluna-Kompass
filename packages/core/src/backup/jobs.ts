import path from 'node:path';
import type { JobSlot, StepLimit } from '../jobs';
import { BACKUP_WORK_PREFIX } from './paths';
import { BACKUP_VERIFY_FAILURES, type BackupSidecar } from './sidecar';

export const BACKUP_JOB_KINDS = ['create', 'verify', 'restore'] as const;
export type BackupJobKind = (typeof BACKUP_JOB_KINDS)[number];

/** Schritte je Lauf (Spec § Hintergrundlauf); `restore` füllt B3. */
export const BACKUP_JOB_STEPS: Record<BackupJobKind, readonly string[]> = {
  create: ['database', 'files', 'verify', 'prune'],
  verify: ['verify'],
  restore: ['safeguard', 'verify', 'replace', 'migrate', 'finish'],
};

const limit = (totalS: number, stallS: number): StepLimit => ({ totalMs: totalS * 1000, stallMs: stallS * 1000 });

/** Zeitgrenzen je Schritt (Gesamt und Stillstand). `migrate` meldet keinen Fortschritt, deshalb Stillstand = Gesamt. */
export const BACKUP_LIMITS: Record<string, StepLimit> = {
  database: limit(600, 120),
  files: limit(3600, 300),
  verify: limit(3600, 300),
  prune: limit(120, 60),
  safeguard: limit(7200, 300),
  replace: limit(3600, 300),
  migrate: limit(1800, 1800),
  finish: limit(120, 120),
};

/**
 * Ein Platz für alle Backup-Läufe — Erstellen, Prüfen und Einspielen schließen sich aus. Riegel und Ergebnisse liegen
 * unter `BACKUP_PATH/.jobs`, damit sie ein Einspielen überleben; Arbeitsdateien `.work-*` direkt im Verzeichnis.
 */
export function backupJobSlot(backupPath: string): JobSlot {
  return { key: `backup:${path.resolve(backupPath)}`, dir: path.join(backupPath, '.jobs'), workDir: backupPath, tmpPrefix: BACKUP_WORK_PREFIX };
}

export const BACKUP_FAILURE_REASONS = [...BACKUP_VERIFY_FAILURES, 'writeFailed', 'cancelled', 'timeout', 'interrupted'] as const;
export type BackupFailureReason = (typeof BACKUP_FAILURE_REASONS)[number];

export interface BackupCreateResult {
  name: string;
  sidecar: BackupSidecar;
  /** Namen, die der Ring nach diesem Backup entfernt hat. */
  pruned: string[];
  /** Scheitert das Aufräumen, gelingt das Backup trotzdem; der Grund steht hier. */
  pruneError: string | null;
}
