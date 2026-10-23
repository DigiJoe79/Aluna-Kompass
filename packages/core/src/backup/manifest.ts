import { z } from 'zod';
import type { AppEnv } from '../deps';

/** Format 3: unkomprimiertes `tar`, Manifest mit Dateiliste. Format 2 (`.tar.gz`, bis 0.3.1) liest Kompass nicht mehr. */
export const BACKUP_FORMAT = 3 as const;

export interface BackupCounts {
  users: number;
  auditEntries: number;
  mediaAssets: number;
  /**
   * Zählungen der Module, Schlüssel `<modul>.<ding>` (z. B. `dms.documents`). Der Kern kennt keine
   * Modul-Tabellen (Prinzip 1); jedes Modul meldet seine Zählung über den Haken `backupCounts`.
   */
  records: Record<string, number>;
}

export type BackupManifest = {
  format: 3;
  appVersion: string;
  createdAt: string;
  environment: AppEnv;
  migrationCount: number;
  counts: BackupCounts;
  /** Was wirklich im Archiv steht, mit Größe — Grundlage der Prüfung. */
  files: { path: string; size: number }[];
};

const count = z.number().int().min(0);

/** Unter `data/`, ohne `..`-Segment: Die Dateiliste darf nie aus dem Abbild herauszeigen. */
const archivePath = z.string().regex(/^data\/(?!.*(^|\/)\.\.(\/|$)).+/);

export const backupManifestSchema: z.ZodType<BackupManifest> = z.object({
  format: z.literal(BACKUP_FORMAT),
  appVersion: z.string(),
  createdAt: z.string(),
  environment: z.enum(['development', 'test', 'production']),
  migrationCount: count,
  counts: z.object({ users: count, auditEntries: count, mediaAssets: count, records: z.record(z.string(), count) }),
  files: z.array(z.object({ path: archivePath, size: count })),
});
