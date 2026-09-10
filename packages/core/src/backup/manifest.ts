import { z } from 'zod';

export const BACKUP_FORMAT = 1 as const;

export const backupManifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  appVersion: z.string(),
  createdAt: z.string(),
  environment: z.enum(['development', 'test', 'production']),
  migrationCount: z.number().int().min(0),
  // `documents` entfällt: die Akte lebt seit dem Umzug ins Modul `dms`, nicht mehr im Kern.
  counts: z.object({ users: z.number().int(), auditEntries: z.number().int(), mediaAssets: z.number().int() }),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;
