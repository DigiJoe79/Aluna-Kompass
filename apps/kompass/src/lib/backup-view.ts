import type { BackupCounts, BackupListKind, BackupOverview, BackupProblem, BackupRetention, BackupVerification } from '@kompass/core';
import { isoDayInZone } from '@kompass/core/dates';

/*
 * Reine Regeln der Backup-Seite (Plan U2): was eine Zeile im Client trägt, welche Zeilen sichtbar sind, der Satz im
 * Seitenkopf, „Bleibt“, Sperrgründe des Zeilenmenüs, Restzeit beim Hochladen und der Ring-Hinweis. Ohne DOM getestet
 * (`tests/backup-view.test.ts`).
 */

/** Eine Zeile der Liste — ohne Manifest und Dateiliste (bei Aluna über 1.600 Einträge je Backup). */
export interface BackupRow {
  name: string;
  kind: BackupListKind;
  createdAt: string;
  sizeBytes: number;
  appVersion: string | null;
  migrationCount: number | null;
  counts: BackupCounts | null;
  verification: BackupVerification;
  pinned: boolean;
  pinnedLabel: string | null;
  restorable: boolean;
  retention: BackupRetention;
  dropsWhenUnpinned: boolean;
}

export function toBackupRow(item: BackupOverview['items'][number]): BackupRow {
  return {
    name: item.name,
    kind: item.kind,
    createdAt: item.createdAt,
    sizeBytes: item.sizeBytes,
    appVersion: item.manifest?.appVersion ?? null,
    migrationCount: item.manifest?.migrationCount ?? null,
    counts: item.manifest?.counts ?? null,
    verification: item.verification,
    pinned: item.pinned,
    pinnedLabel: item.pinnedLabel,
    restorable: item.restorable,
    retention: item.retention,
    dropsWhenUnpinned: item.dropsWhenUnpinned ?? false,
  };
}

const DAY_MS = 86_400_000;
/** Kalenderrechnung auf einem Vereinstag: in UTC, weil `day` schon der Tag in der Vereinszone ist. */
const minusDays = (day: string, n: number) => isoDayInZone(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS, 'UTC');

/**
 * Sichtbar sind die letzten `days` Vereinstage, alles von Hand und alles Festgehaltene (Designer 1a, Nachtrag 6b);
 * der Rest zählt nach Stand („Ältere: …“). Mit `showAll` steht alles. Die Reihenfolge der Eingabe bleibt.
 */
export function visibleBackups(
  rows: readonly BackupRow[],
  opts: { today: string; timeZone: string; showAll: boolean; days?: number },
): { shown: BackupRow[]; hidden: { weekly: number; monthly: number; other: number }; total: number } {
  const hidden = { weekly: 0, monthly: 0, other: 0 };
  if (opts.showAll) return { shown: [...rows], hidden, total: rows.length };
  const from = minusDays(opts.today, (opts.days ?? 7) - 1);
  const shown: BackupRow[] = [];
  for (const row of rows) {
    if (row.kind === 'manual' || row.pinned || isoDayInZone(new Date(row.createdAt), opts.timeZone) >= from) {
      shown.push(row);
      continue;
    }
    const tier = row.retention.kind === 'until' ? row.retention.tier : null;
    if (tier === 'weekly') hidden.weekly++;
    else if (tier === 'monthly') hidden.monthly++;
    else hidden.other++;
  }
  return { shown, hidden, total: rows.length };
}

export type HeadlineState = { tone: 'ok' | 'warn'; sentence: 'ok' | 'lastVerified' | 'none'; lastVerified: BackupRow | null; notice: 'failed' | 'nightlyMissing' | null };

/**
 * Der Satz im Seitenkopf und die Warnung darunter (Designer § 2, Nachtrag § 2): „gescheitert“ geht vor „fehlt“, nie
 * beide; ein laufendes Backup ersetzt die Warnung „fehlt“ (die RunCard steht dann); ein gescheitertes Aufräumen
 * lässt den Satz normal — das Backup selbst ist gelungen.
 */
export function backupHeadline(input: { rows: readonly BackupRow[]; lastError: BackupProblem | null; nightlyMissing: boolean; running: boolean }): HeadlineState {
  const lastVerified = input.rows.find((r) => r.verification.status === 'passed') ?? null;
  const problem = input.lastError !== null && input.lastError.code !== 'pruneFailed';
  const notice = input.lastError ? 'failed' : input.nightlyMissing && !input.running ? 'nightlyMissing' : null;
  const sentence = !lastVerified ? 'none' : problem || input.nightlyMissing ? 'lastVerified' : 'ok';
  const tone = !lastVerified || problem || input.nightlyMissing ? 'warn' : 'ok';
  return { tone, sentence, lastVerified, notice };
}

export type RetentionKey = 'until' | 'weekly' | 'monthly' | 'untilNextManual' | 'untilNewer' | 'untilNextVerified' | 'kept' | 'prune' | 'pinned';

/** Schlüssel und Werte für die Spalte „Bleibt“ (`backup.list.keep.*`). */
export function retentionMessage(retention: BackupRetention, kind: BackupListKind): { key: RetentionKey; until?: string; kind?: BackupListKind } {
  switch (retention.kind) {
    case 'until':
      return { key: retention.tier === 'weekly' ? 'weekly' : retention.tier === 'monthly' ? 'monthly' : 'until', until: retention.until };
    case 'untilNewer':
      return { key: 'untilNewer', kind };
    default:
      return { key: retention.kind };
  }
}

export type RowAction = 'restore' | 'download' | 'pin' | 'rename' | 'unpin' | 'verify' | 'audit' | 'delete';
export type RowDisabledReason = null | 'failed' | 'unverified' | 'newer' | 'running' | 'pinLimit' | 'lastVerified';

/**
 * Das Zeilenmenü in der Reihenfolge des Designers (Einspielen zuerst, Löschen zuletzt). Ohne Recht ausgeblendet,
 * fachlich gesperrt mit Grund (MUSTER § C/G).
 */
export function rowActions(
  row: BackupRow,
  ctx: { running: boolean; pinnedCount: number; pinnedMax: number; newestVerifiedName: string | null; canImport: boolean; canAudit: boolean; appMigrationCount: number },
): { action: RowAction; hidden: boolean; disabledReason: RowDisabledReason }[] {
  const restoreReason: RowDisabledReason = ctx.running
    ? 'running'
    : row.verification.status === 'failed'
      ? 'failed'
      : row.migrationCount !== null && row.migrationCount > ctx.appMigrationCount
        ? 'newer'
        : !row.restorable
          ? 'unverified'
          : null;
  return [
    { action: 'restore', hidden: !ctx.canImport, disabledReason: restoreReason },
    { action: 'download', hidden: false, disabledReason: null },
    { action: 'pin', hidden: row.pinned, disabledReason: ctx.pinnedCount >= ctx.pinnedMax ? 'pinLimit' : null },
    { action: 'rename', hidden: !row.pinned, disabledReason: null },
    { action: 'unpin', hidden: !row.pinned, disabledReason: null },
    { action: 'verify', hidden: false, disabledReason: ctx.running ? 'running' : null },
    { action: 'audit', hidden: !ctx.canAudit, disabledReason: null },
    { action: 'delete', hidden: !ctx.canImport, disabledReason: ctx.running ? 'running' : ctx.newestVerifiedName === row.name ? 'lastVerified' : null },
  ];
}

/** Restzeit des Hochladens in ganzen Minuten (aufgerundet, mindestens 1) aus der bisherigen Rate; `null` in den ersten 3 s. */
export function uploadEta(doneBytes: number, totalBytes: number, elapsedMs: number): number | null {
  if (elapsedMs < 3000 || doneBytes <= 0) return null;
  const restMs = ((totalBytes - doneBytes) / doneBytes) * elapsedMs;
  return Math.max(1, Math.ceil(restMs / 60_000));
}

/** Höchstzahl automatischer Backups im Ring und — bei bekannter Größe eines Backups — der Platz dafür. */
export function ringHint(ring: { daily: number; weekly: number; monthly: number }, referenceBytes: number | null): { count: number; totalBytes: number | null } {
  const count = ring.daily + ring.weekly + ring.monthly;
  return { count, totalBytes: referenceBytes === null ? null : count * referenceBytes };
}
