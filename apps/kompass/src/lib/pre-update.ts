import { migrationsFolder, type BackupSidecar, type RuntimeEnv, type runPreUpdateBackup } from '@kompass/core';
import { appVersion } from './build';

/**
 * Backup vor Update beim Start (Spec Backup § Backup vor Update): läuft in `register()` vor dem ersten `getDeps`, also
 * vor den Migrationen. Scheitert es, startet Kompass nicht und migriert nicht; das Log nennt den Grund und den Ausweg.
 * Liefert die Begleitdatei, wenn gesichert wurde — das Protokoll schreibt der Aufrufer, sobald die Datenbank offen ist.
 */
export async function preUpdateGate(
  env: RuntimeEnv,
  io: { run: typeof runPreUpdateBackup; exit: (code: number) => never; log: Pick<Console, 'warn' | 'error' | 'log'>; now: () => Date },
): Promise<BackupSidecar | null> {
  if (env.skipUpdateBackup) {
    io.log.warn('[kompass] KOMPASS_SKIP_UPDATE_BACKUP=1 — Start ohne Backup vor Update. Nach dem Start wieder entfernen.');
    return null;
  }
  try {
    const result = await io.run({ dataPath: env.dataPath, backupPath: env.backupPath, env: env.env, appVersion: appVersion(), migrationsFolder: migrationsFolder(), now: io.now() });
    if (result.status === 'notNeeded') return null;
    io.log.log('[kompass] Backup vor Update: %s', result.sidecar.name);
    return result.sidecar;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.log.error(
      '[kompass] Backup vor Update gescheitert: %s. Kompass startet nicht und migriert nicht. Ausweg für einen Start ohne Backup: KOMPASS_SKIP_UPDATE_BACKUP=1 in der .env.',
      message,
    );
    return io.exit(1);
  }
}
