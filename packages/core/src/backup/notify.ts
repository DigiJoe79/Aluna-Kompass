import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { isoNow } from '../clock';
import { isoDayInZone } from '../dates';
import { users } from '../db/schema';
import type { Deps } from '../deps';
import { messageDateTime } from '../message-date';
import { getEffectivePermissions } from '../roles/effective';
import { readSetting } from '../settings/service';
import { sendSystemMail } from '../system-mail';
import { timeZoneOf } from '../today';
import { readBackupState, updateBackupState, type BackupProblem, type BackupProblemCode } from './state';

/**
 * Texte der Backup-Mail (Spec Backup § Meldungen). Eine Sprachtabelle im Code wie die Testmail der Akte: Die Mail
 * entsteht ohne Anfrage und ohne die Sprachdatei der App (AGENTS Prinzip 7, Ausnahme). Platzhalter `{Verein}`,
 * `{Problem}`, `{Zeit}`, `{Umgebung}`.
 */
export const BACKUP_MAIL_TEXTS: Record<string, { subject: string; body: string; problems: Record<BackupProblemCode, string> }> = {
  de: {
    subject: 'Kompass ({Umgebung}): Problem mit dem Backup',
    body:
      'Guten Tag,\n\nbeim Backup von Kompass für {Verein} gibt es ein Problem.\n\n{Problem}\n\nZeitpunkt: {Zeit}\n\n' +
      'Die Backup-Seite finden Sie in Kompass unter System › Backup.\n\nDiese Nachricht hat Kompass ({Umgebung}) automatisch geschickt.',
    problems: {
      createFailed: 'Ein Backup konnte nicht erstellt werden.',
      verifyFailed: 'Ein Backup hat die Prüfung nicht bestanden.',
      pruneFailed: 'Alte Backups konnten nicht aufgeräumt werden.',
      interrupted: 'Ein Backup wurde unterbrochen, vermutlich durch einen Neustart.',
      preUpdateFailed: 'Das Backup vor dem Update ist gescheitert; Kompass ist deshalb nicht gestartet.',
      backupPathUnwritable: 'Das Backup-Verzeichnis ist nicht beschreibbar.',
      storageLow: 'Der Platz im Backup-Verzeichnis reicht nur noch für weniger als zwei weitere Backups.',
      notMounted: 'Das Backup-Verzeichnis ist nicht eingehängt. Backups gingen beim Neuerstellen des Containers verloren.',
    },
  },
  en: {
    subject: 'Kompass ({Umgebung}): backup problem',
    body:
      'Hello,\n\nthere is a problem with the backup of Kompass for {Verein}.\n\n{Problem}\n\nTime: {Zeit}\n\n' +
      'You will find the backup page in Kompass under System › Backup.\n\nKompass ({Umgebung}) sent this message automatically.',
    problems: {
      createFailed: 'A backup could not be created.',
      verifyFailed: 'A backup failed its check.',
      pruneFailed: 'Old backups could not be cleaned up.',
      interrupted: 'A backup was interrupted, probably by a restart.',
      preUpdateFailed: 'The backup before the update failed, so Kompass did not start.',
      backupPathUnwritable: 'The backup directory is not writable.',
      storageLow: 'The space in the backup directory is enough for fewer than two more backups.',
      notMounted: 'The backup directory is not mounted. Backups would be lost when the container is recreated.',
    },
  },
};

const REASON_LABEL: Record<string, string> = { de: 'Grund', en: 'Reason' };
const BACKUP_LABEL: Record<string, string> = { de: 'Backup', en: 'Backup' };

/**
 * Zustände, die keinen „letzten Fehler“ setzen und höchstens einmal je Vereinstag mailen. Auch das nicht beschreibbare
 * Verzeichnis: Der Zeitplan prüft es alle 10 min, und eine Zustandsdatei, die den Tag merkt, gibt es dann nicht.
 */
const DAILY_WARNINGS = ['storageLow', 'notMounted', 'backupPathUnwritable'] as const;

/** Der Tag der letzten Warnmail auch im Speicher — falls die Zustandsdatei nicht schreibbar ist. Je Prozess. */
const warnedToday = ((globalThis as { __kompassBackupWarnedDay?: Map<string, string> }).__kompassBackupWarnedDay ??= new Map<string, string>());
type DailyWarning = (typeof DAILY_WARNINGS)[number];
const isDailyWarning = (code: BackupProblemCode): code is DailyWarning => (DAILY_WARNINGS as readonly string[]).includes(code);

const fill = (text: string, values: Record<string, string>) => text.replace(/\{([A-Za-z]+)\}/g, (match, name: string) => values[name] ?? match);

/** Aktive Nutzer mit `backup.export` und gültiger E-Mail-Adresse. */
export function backupAlertRecipients(deps: Deps): { userId: string; email: string }[] {
  return deps.db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.isActive, true))
    .all()
    .filter((u) => z.email().safeParse(u.email).success && getEffectivePermissions(deps.db, deps.registry, u.id).has('backup.export'))
    .map((u) => ({ userId: u.id, email: u.email }));
}

async function mailProblem(deps: AppDeps, problem: BackupProblem): Promise<number> {
  const recipients = backupAlertRecipients(deps);
  if (recipients.length === 0) return 0;
  // Nutzer haben keine eigene Sprache: Leitsprache, Rückfall Deutsch.
  const locale = deps.locales()[0] ?? 'de';
  const texts = BACKUP_MAIL_TEXTS[locale] ?? BACKUP_MAIL_TEXTS.de!;
  const lang = BACKUP_MAIL_TEXTS[locale] ? locale : 'de';
  const lines = [texts.problems[problem.code]];
  if (problem.name) lines.push(`${BACKUP_LABEL[lang]}: ${problem.name}`);
  if (problem.reason) lines.push(`${REASON_LABEL[lang]}: ${problem.reason}`);
  const values = {
    Verein: readSetting<string>(deps, 'organization.name'),
    Problem: lines.join('\n'),
    Zeit: messageDateTime(deps, problem.at),
    Umgebung: deps.env,
  };
  let mailed = 0;
  for (const r of recipients) {
    const result = await sendSystemMail(deps, { to: r.email, subject: fill(texts.subject, values), text: fill(texts.body, values) });
    if (result.sent) mailed += 1;
  }
  return mailed;
}

/**
 * Schreibt die Zustandsdatei, ohne die Meldung zu gefährden: Ist das Backup-Verzeichnis nicht beschreibbar, geht die
 * Mail trotzdem hinaus, und das Log nennt den Grund. Merken und Mailen hängen nicht voneinander ab.
 */
function persistState(bp: string, patch: Parameters<typeof updateBackupState>[1]): void {
  try {
    updateBackupState(bp, patch);
  } catch (error) {
    console.error('[backup] Zustandsdatei nicht geschrieben', error);
  }
}

/**
 * Meldet ein Problem: merkt es als letzten Fehler (außer den Tageswarnungen) und schreibt den Verantwortlichen eine
 * Mail, sofern ein Modul Systemmails senden kann. Wirft nicht wegen eines fehlenden Versandwegs.
 */
export async function reportBackupProblem(deps: AppDeps, problem: Omit<BackupProblem, 'at' | 'mailed'>): Promise<{ mailed: number }> {
  const bp = deps.backupPath;
  if (!bp) return { mailed: 0 };
  const at = isoNow(deps.clock);
  if (isDailyWarning(problem.code)) {
    const today = isoDayInZone(deps.clock.now(), timeZoneOf(deps));
    const memo = `${bp}|${problem.code}`;
    if (readBackupState(bp).warningMailDay[problem.code] === today || warnedToday.get(memo) === today) return { mailed: 0 };
    warnedToday.set(memo, today);
    persistState(bp, { warningMailDay: { ...readBackupState(bp).warningMailDay, [problem.code]: today } });
    return { mailed: await mailProblem(deps, { ...problem, at, mailed: false }) };
  }
  const stored: BackupProblem = { ...problem, at, mailed: false };
  persistState(bp, { lastError: stored });
  const mailed = await mailProblem(deps, stored);
  if (mailed > 0) persistState(bp, { lastError: { ...stored, mailed: true } });
  return { mailed };
}

/** Ein Backup ist gelungen: Der letzte Fehler ist erledigt; die Tageszähler bleiben. */
export function clearBackupProblem(backupPath: string): void {
  if (readBackupState(backupPath).lastError === null) return;
  updateBackupState(backupPath, { lastError: null });
}
