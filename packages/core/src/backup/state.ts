import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeJsonAtomic } from '../jobs';
import { BACKUP_KINDS, type BackupKind } from './sidecar';

/**
 * Zustand der Backup-Meldungen (Spec Backup § Meldungen) in `BACKUP_PATH/.jobs/backup-state.json`: Er gehört zum
 * Verzeichnis, nicht in die Datenbank, damit er ein Einspielen überlebt — wie Begleitdateien und Laufergebnisse.
 */
export const BACKUP_PROBLEMS = ['createFailed', 'verifyFailed', 'pruneFailed', 'interrupted', 'preUpdateFailed', 'backupPathUnwritable', 'storageLow', 'notMounted'] as const;
export type BackupProblemCode = (typeof BACKUP_PROBLEMS)[number];

export interface BackupProblem {
  code: BackupProblemCode;
  at: string;
  kind: BackupKind | null;
  name: string | null;
  /** Grund als Code oder technische Meldung; nie ein Satz der Oberfläche. */
  reason: string | null;
  mailed: boolean;
}

export interface BackupState {
  /** Der letzte Fehler; steht bis zum nächsten gelungenen Backup. */
  lastError: BackupProblem | null;
  /** Vereinstag, an dem der Zeitplan zuletzt ein automatisches Backup versucht hat. */
  lastScheduleAttemptDay: string | null;
  /** Vereinstag der letzten Mail je Warnung — höchstens eine je Tag. */
  warningMailDay: { storageLow: string | null; notMounted: string | null; backupPathUnwritable: string | null };
  /** Der zuletzt gemeldete unterbrochene Lauf, damit er nur einmal meldet. */
  lastReportedRunId: string | null;
}

const DEFAULT_STATE: BackupState = { lastError: null, lastScheduleAttemptDay: null, warningMailDay: { storageLow: null, notMounted: null, backupPathUnwritable: null }, lastReportedRunId: null };

const problemSchema = z.object({
  code: z.enum(BACKUP_PROBLEMS),
  at: z.string(),
  kind: z.enum(BACKUP_KINDS).nullable(),
  name: z.string().nullable(),
  reason: z.string().nullable(),
  mailed: z.boolean(),
});

const stateSchema = z.object({
  lastError: problemSchema.nullable().catch(null),
  lastScheduleAttemptDay: z.string().nullable().catch(null),
  warningMailDay: z.object({ storageLow: z.string().nullable().catch(null), notMounted: z.string().nullable().catch(null), backupPathUnwritable: z.string().nullable().catch(null) }).catch({ storageLow: null, notMounted: null, backupPathUnwritable: null }),
  lastReportedRunId: z.string().nullable().catch(null),
});

const stateFile = (backupPath: string) => path.join(backupPath, '.jobs', 'backup-state.json');

/** Fehlt die Datei oder ist sie kaputt, gilt die Vorgabe (nichts gemerkt). */
export function readBackupState(backupPath: string): BackupState {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(readFileSync(stateFile(backupPath), 'utf8')));
    return parsed.success ? parsed.data : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

/** Liest, mischt flach (`warningMailDay` tief) und schreibt atomar. */
export function updateBackupState(backupPath: string, patch: Partial<BackupState>): BackupState {
  const current = readBackupState(backupPath);
  const next: BackupState = { ...current, ...patch, warningMailDay: { ...current.warningMailDay, ...patch.warningMailDay } };
  mkdirSync(path.dirname(stateFile(backupPath)), { recursive: true });
  writeJsonAtomic(stateFile(backupPath), next);
  return next;
}
