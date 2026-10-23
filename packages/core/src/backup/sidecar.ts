import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { AppEnv } from '../deps';
import { backupManifestSchema, type BackupManifest } from './manifest';

/*
 * Je Backup zwei Dateien: das Archiv `<name>.tar` und die Begleitdatei `<name>.json`. Art, Festhalten und
 * Prüfergebnis gehören zur Datei, nicht in die Datenbank — das Verzeichnis überlebt ein Einspielen, die
 * Datenbank nicht. Die Liste liest deshalb nur die Begleitdateien.
 */

export const BACKUP_KINDS = ['automatic', 'manual', 'preUpdate', 'preRestore', 'upload'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];
/** `unknown`: ein Archiv ohne Begleitdatei, etwa von Hand abgelegt. */
export type BackupListKind = BackupKind | 'unknown';

export const BACKUP_VERIFY_FAILURES = [
  'backupFormatUnsupported',
  'backupUnreadable',
  'backupFileMissing',
  'backupFileSizeMismatch',
  'backupCorrupt',
  'backupChecksumMismatch',
] as const;
export type BackupVerifyFailure = (typeof BACKUP_VERIFY_FAILURES)[number];

export type BackupVerification =
  | { status: 'unverified' }
  | { status: 'passed'; at: string }
  | { status: 'failed'; at: string; reason: BackupVerifyFailure };

export interface BackupSidecar {
  version: 1;
  name: string;
  kind: BackupListKind;
  createdAt: string;
  sizeBytes: number;
  sha256: string | null;
  manifest: BackupManifest | null;
  verification: BackupVerification;
  pinned: boolean;
  /** Kurzer Name beim Festhalten, höchstens 60 Zeichen. */
  pinnedLabel: string | null;
}

export interface BackupListItem extends BackupSidecar {
  hasSidecar: boolean;
}

const ARCHIVE_EXT = '.tar';
const SIDECAR_EXT = '.json';

const sidecarSchema: z.ZodType<BackupSidecar> = z.object({
  version: z.literal(1),
  name: z.string(),
  kind: z.enum([...BACKUP_KINDS, 'unknown']),
  createdAt: z.string(),
  sizeBytes: z.number().int().min(0),
  sha256: z.string().nullable(),
  manifest: backupManifestSchema.nullable(),
  verification: z.discriminatedUnion('status', [
    z.object({ status: z.literal('unverified') }),
    z.object({ status: z.literal('passed'), at: z.string() }),
    z.object({ status: z.literal('failed'), at: z.string(), reason: z.enum(BACKUP_VERIFY_FAILURES) }),
  ]),
  pinned: z.boolean(),
  pinnedLabel: z.string().max(60).nullable(),
});

/** `kompass-backup-<umgebung>-<JJJJMMTT-HHMMSS>-<art>`, ohne Endung; Zeit in UTC wie der Zeitstempel. */
export function backupFileName(env: AppEnv, createdAtIso: string, kind: BackupKind): string {
  const stamp = createdAtIso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `kompass-backup-${env}-${stamp}-${kind}`;
}

/** Ein einfacher Dateiname ohne Endung: kein Pfad, keine Punktdatei (Arbeitsdateien), kein `..`. */
export function isBackupName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) && !name.endsWith(ARCHIVE_EXT) && !name.endsWith(SIDECAR_EXT);
}

/** `null` bei ungültigem Namen oder einem Pfad außerhalb von `backupPath`. */
export function backupFiles(backupPath: string, name: string): { archive: string; sidecar: string } | null {
  if (!isBackupName(name)) return null;
  const root = path.resolve(backupPath);
  const archive = path.resolve(root, name + ARCHIVE_EXT);
  const sidecar = path.resolve(root, name + SIDECAR_EXT);
  if (!archive.startsWith(root + path.sep) || !sidecar.startsWith(root + path.sep)) return null;
  return { archive, sidecar };
}

/** `base`, sonst `base-2`, `base-3` … — zwei Backups derselben Art in derselben Sekunde überschreiben sich nie. */
export function uniqueBackupName(backupPath: string, base: string): string {
  const taken = (name: string) =>
    existsSync(path.join(backupPath, name + ARCHIVE_EXT)) || existsSync(path.join(backupPath, name + SIDECAR_EXT));
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Fehlt die Begleitdatei oder ist sie unlesbar, `null` — kein Wurf. */
export function readSidecar(backupPath: string, name: string): BackupSidecar | null {
  const files = backupFiles(backupPath, name);
  if (!files) return null;
  let raw: string;
  try {
    raw = readFileSync(files.sidecar, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = sidecarSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Atomar über eine Zwischendatei und `rename`: Ein Abbruch hinterlässt die alte oder die neue Fassung, nie eine halbe. */
export function writeSidecar(backupPath: string, sidecar: BackupSidecar): void {
  const files = backupFiles(backupPath, sidecar.name);
  if (!files) throw new Error(`invalid backup name: ${sidecar.name}`);
  const tmp = `${files.sidecar}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(sidecar, null, 2));
  renameSync(tmp, files.sidecar);
}

/** Alle Archive im Verzeichnis, neueste zuerst. Begleitdateien ohne Archiv erscheinen nicht. */
export function listBackups(backupPath: string): BackupListItem[] {
  let entries: string[];
  try {
    entries = readdirSync(backupPath);
  } catch {
    return [];
  }
  const items: BackupListItem[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || !entry.endsWith(ARCHIVE_EXT)) continue;
    const name = entry.slice(0, -ARCHIVE_EXT.length);
    if (!isBackupName(name)) continue;
    const sidecar = readSidecar(backupPath, name);
    if (sidecar) {
      items.push({ ...sidecar, name, hasSidecar: true });
      continue;
    }
    const stat = statSync(path.join(backupPath, entry), { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    items.push({
      version: 1,
      name,
      kind: 'unknown',
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      sha256: null,
      manifest: null,
      verification: { status: 'unverified' },
      pinned: false,
      pinnedLabel: null,
      hasSidecar: false,
    });
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Das neueste Backup mit bestandener Prüfung; ungeprüfte und gescheiterte zählen nicht. */
export function newestVerifiedBackup(backupPath: string): BackupListItem | null {
  return listBackups(backupPath).find((item) => item.verification.status === 'passed') ?? null;
}
