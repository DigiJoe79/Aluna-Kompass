import { accessSync, constants, mkdirSync } from 'node:fs';
import type { AppDeps } from '../app';
import { systemContext } from '../context';
import { formatTime, isoDayInZone } from '../dates';
import type { Deps } from '../deps';
import { readJobResult } from '../jobs';
import { readSetting } from '../settings/service';
import { timeZoneOf } from '../today';
import { launchBackupCreate } from './create';
import { backupJobSlot } from './jobs';
import { reportBackupProblem } from './notify';
import { BACKUP_KINDS, listBackups, type BackupKind } from './sidecar';
import { readBackupState, updateBackupState } from './state';
import { backupStorage } from './storage';

/**
 * Zeitplan der automatischen Backups (Spec Backup § Zeitplan). Kompass hat keinen Zeitplaner, nur die Hauswirtschaft
 * alle 10 min; der nächtliche Lauf hängt sich dort ein.
 */

/** Zwei Hauswirtschaftsrunden nach der Uhrzeit fehlt das nächtliche Backup (Spec § Zeitplan, R5). */
export const NIGHTLY_GRACE_MINUTES = 20;

/** Die Uhrzeit `'HH:MM'` (24 h) in der Zeitzone. */
export function wallClockInZone(now: Date, timeZone: string): string {
  return formatTime(now, timeZone);
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Warnung „nächtliches Backup fehlt“: Zeitplan an, seit der Uhrzeit des Vereinstags kein geprüftes Backup, und die
 * Uhrzeit plus 20 min ist vorbei. Reicht das über Mitternacht, gilt der Tag nicht als fällig (der Folgetag beginnt
 * von vorn). Jede Art zählt, nicht nur das automatische: Die Warnung rät, eines von Hand zu erstellen, und das muss
 * sie beenden (Joe 2026-10-23 auf Test).
 */
export function isNightlyBackupMissing(input: { now: Date; timeZone: string; enabled: boolean; time: string; verifiedSinceTime: boolean }): boolean {
  if (!input.enabled || input.verifiedSinceTime) return false;
  return minutesOf(wallClockInZone(input.now, input.timeZone)) >= minutesOf(input.time) + NIGHTLY_GRACE_MINUTES;
}

/** Zeitplan aus den Einstellungen. */
export function backupScheduleOf(deps: Deps): { enabled: boolean; time: string } {
  return { enabled: readSetting<boolean>(deps, 'backup.schedule.enabled'), time: readSetting<string>(deps, 'backup.schedule.time') };
}

/** Fehlt heute (Vereinstag) das nächtliche Backup? Ohne Verzeichnis nie. */
export function nightlyBackupMissing(deps: Deps): boolean {
  if (!deps.backupPath) return false;
  const tz = timeZoneOf(deps);
  const now = deps.clock.now();
  const today = isoDayInZone(now, tz);
  const schedule = backupScheduleOf(deps);
  const verifiedSinceTime = listBackups(deps.backupPath).some((i) => {
    if (i.verification.status !== 'passed') return false;
    const at = new Date(i.createdAt);
    return isoDayInZone(at, tz) === today && minutesOf(wallClockInZone(at, tz)) >= minutesOf(schedule.time);
  });
  return isNightlyBackupMissing({ now, timeZone: tz, ...schedule, verifiedSinceTime });
}

/** Ein Deps-Objekt der laufenden App (nicht `createTestDeps`): kann sichern. */
export function isAppDeps(deps: Deps): deps is AppDeps {
  return typeof (deps as AppDeps).backupDatabase === 'function' && 'dataPath' in deps;
}

/**
 * Ist das automatische Backup fällig? Zeitplan an, für den Vereinstag weder ein automatisches Backup noch ein Versuch,
 * und die Uhrzeit ist vorbei — so holt ein verpasster Lauf (Neustart um 3 Uhr) im nächsten Takt nach.
 */
export function isScheduledBackupDue(input: { now: Date; timeZone: string; enabled: boolean; time: string; lastAttemptDay: string | null; automaticToday: boolean }): boolean {
  if (!input.enabled || input.automaticToday) return false;
  if (input.lastAttemptDay === isoDayInZone(input.now, input.timeZone)) return false;
  return minutesOf(wallClockInZone(input.now, input.timeZone)) >= minutesOf(input.time);
}

/**
 * Ein Takt des Zeitplans: startet das automatische Backup, wenn es fällig ist. Ein Versuch zählt für den Tag, auch
 * wenn er scheitert — ein gescheiterter Lauf wird nicht alle 10 Minuten wiederholt, die Meldung schickt der Lauf.
 */
export async function runBackupSchedule(deps: AppDeps): Promise<'noPath' | 'disabled' | 'notDue' | 'busy' | 'started'> {
  const bp = deps.backupPath;
  if (!bp) return 'noPath';
  const schedule = backupScheduleOf(deps);
  if (!schedule.enabled) return 'disabled';
  const tz = timeZoneOf(deps);
  const now = deps.clock.now();
  const today = isoDayInZone(now, tz);
  const automaticToday = listBackups(bp).some((i) => i.kind === 'automatic' && isoDayInZone(new Date(i.createdAt), tz) === today);
  const due = isScheduledBackupDue({ now, timeZone: tz, ...schedule, lastAttemptDay: readBackupState(bp).lastScheduleAttemptDay, automaticToday });
  if (!due) return 'notDue';
  try {
    mkdirSync(bp, { recursive: true });
    accessSync(bp, constants.W_OK);
  } catch {
    // Ohne beschreibbares Verzeichnis gibt es nicht einmal die Zustandsdatei; die Meldung geht trotzdem per Mail.
    try {
      updateBackupState(bp, { lastScheduleAttemptDay: today });
    } catch {
      // nichts zu merken
    }
    await reportBackupProblem(deps, { code: 'backupPathUnwritable', kind: 'automatic', name: null, reason: null }).catch((error: unknown) => console.error('[backup] Meldung gescheitert', error));
    return 'notDue';
  }
  const started = launchBackupCreate(deps, systemContext('backup-schedule'), 'automatic', 'system');
  if ('busy' in started) return 'busy';
  updateBackupState(bp, { lastScheduleAttemptDay: today });
  started.done.catch((error: unknown) => console.error('[backup] automatisches Backup gescheitert', error));
  return 'started';
}

const kindOf = (value: unknown): BackupKind | null => ((BACKUP_KINDS as readonly unknown[]).includes(value) ? (value as BackupKind) : null);

/**
 * Wache im Takt der Hauswirtschaft: Speicher-Vorwarnung und fehlende Einhängung (je einmal am Tag), ein unterbrochener
 * Lauf (genau einmal) und ein letzter Fehler, dessen Mail noch aussteht — etwa vom Backup vor dem Update, als es noch
 * keinen Versandweg gab.
 */
export async function checkBackupHealth(deps: AppDeps): Promise<void> {
  const bp = deps.backupPath;
  if (!bp) return;
  if ((await backupStorage(bp))?.low) await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null });
  if (deps.backupMountWarning === 'notMounted') await reportBackupProblem(deps, { code: 'notMounted', kind: null, name: null, reason: null });
  const last = readJobResult(backupJobSlot(bp), 'create');
  if (last?.status === 'interrupted' && last.runId !== readBackupState(bp).lastReportedRunId) {
    updateBackupState(bp, { lastReportedRunId: last.runId });
    const name = typeof last.meta.name === 'string' ? last.meta.name : null;
    await reportBackupProblem(deps, { code: 'interrupted', kind: kindOf(last.meta.backupKind), name, reason: last.lastStep ?? null });
  }
  const pending = readBackupState(bp).lastError;
  if (pending && !pending.mailed) {
    const { at: _at, mailed: _mailed, ...problem } = pending;
    await reportBackupProblem(deps, problem);
  }
}
